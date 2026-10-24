import { keccakOf } from "./canonical.ts";
import { AGENTS, type AgentOpinion, type MarketInput } from "./schema.ts";

/**
 * Prompt templates live in `prompts/*.txt` and are committed to git, because
 * the plan file records `promptTemplateSha = keccak256(template bytes)`.
 * Hashing a string nobody can obtain would make "we can verify which prompt was
 * used" an empty claim; hashing a committed file makes it third-party
 * recomputable:
 *
 *   cast keccak 0x$(xxd -p -c 1000000 src/backend/prompts/bull.txt | tr -d '\n')
 *
 * Templates contain no placeholders: they describe the JSON input, and the
 * rendered values are carried by `input` in the plan file. There is therefore
 * nothing to hash twice — the template plus the input fully determine the ask.
 */

export const PROMPT_NAMES = [...AGENTS, "judge"] as const;
export type PromptName = (typeof PROMPT_NAMES)[number];

export type PromptTemplate = {
  name: PromptName;
  path: string;
  text: string;
  keccak256: `0x${string}`;
};

const cache = new Map<string, Promise<Record<PromptName, PromptTemplate>>>();

async function readAll(dir: string): Promise<Record<PromptName, PromptTemplate>> {
  const entries = await Promise.all(
    PROMPT_NAMES.map(async (name) => {
      const path = `${dir}/${name}.txt`;
      const file = Bun.file(path);
      if (!(await file.exists())) {
        throw new Error(`missing prompt template: ${path} — it must be committed, not generated at runtime`);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length === 0) throw new Error(`prompt template is empty: ${path}`);
      return [name, { name, path, text: new TextDecoder().decode(bytes), keccak256: keccakOf(bytes) }] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<PromptName, PromptTemplate>;
}

/** Read all four templates, memoised per directory. */
export function loadPromptTemplates(dir = "prompts"): Promise<Record<PromptName, PromptTemplate>> {
  const cached = cache.get(dir);
  if (cached) return cached;
  const loaded = readAll(dir);
  cache.set(dir, loaded);
  return loaded;
}

/** Test seam: forget cached templates (used when a test rewrites a template). */
export function resetPromptCache(): void {
  cache.clear();
}

const indent = (value: unknown) => JSON.stringify(value, null, 2);

/** What each debating agent sees: the same authoritative input, verbatim. */
export function renderAgentUserMessage(input: MarketInput): string {
  return indent(input);
}

/**
 * What the judge sees: the same input plus the three opinions. Provenance is
 * stripped — the judge is deciding on reasoning, not on model names.
 */
export function renderJudgeUserMessage(input: MarketInput, rounds: AgentOpinion[]): string {
  return indent({
    input,
    rounds: rounds.map(({ agent, targetWethBps, confidence, reason }) => ({
      agent,
      targetWethBps,
      confidence,
      reason,
    })),
  });
}

/**
 * 按 keccak 反查 prompt 原文 —— 「改 prompt 不再让历史计划失效」的那一半。
 *
 * ## 为什么需要它
 *
 * 计划文件只记 `promptTemplateSha`，不记 prompt 原文。所以校验历史计划时，
 * 如果只拿「当前 prompts/ 目录」去比，一旦 prompt 被改写，旧计划的哈希就
 * 永远对不上 —— **那些计划的「prompt 可复算」永久失效**，而可复算正是
 * 这个产品卖的东西。
 *
 * 实测踩过：2026-10-24 15:16 改了四个 prompt（去掉一条偏向保守的指令），
 * 结果 8 份历史计划从「可复算」变成「不可复算」，`--check` 红 32 项。
 *
 * ## 修法：content-addressed 存档
 *
 * `prompts/archive/<keccak>.txt` —— 文件名就是它自己的哈希。
 * 于是：
 *   - 改 prompt 是**新增**一个存档，不是覆盖（历史字节永远还在）
 *   - 只要链上/计划里记着 hash，就永远能找回当时那份原文
 *   - 找回后可以重新校验：keccak(找到的字节) === 计划里记的 hash
 *
 * 这正是「内容寻址」该有的性质：**名字就是校验和**。
 *
 * 找不到时返回 null，而不是抛错 —— 校验方要知道「缺了什么」，
 * 而不是让整个 --check 因为一个缺失文件崩掉。
 */
export async function findPromptByHash(
  hash: string,
  dir = "prompts",
): Promise<{ path: string; bytes: Uint8Array } | null> {
  const want = hash.toLowerCase();

  // 先看当前目录：绝大多数情况下就是它，省一次磁盘往返。
  // 注意不能因为「名字对」就认为「内容对」—— 必须算哈希。
  for (const name of PROMPT_NAMES) {
    const path = `${dir}/${name}.txt`;
    const file = Bun.file(path);
    if (!(await file.exists())) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (keccakOf(bytes).toLowerCase() === want) return { path, bytes };
  }

  // 再按哈希去存档里找。文件名就是哈希，所以这是一次直接的路径查找。
  const archived = `${dir}/archive/${want}.txt`;
  const file = Bun.file(archived);
  if (await file.exists()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // 文件名可能被手工改过 —— 仍然要验内容，不能只信文件名。
    if (keccakOf(bytes).toLowerCase() === want) return { path: archived, bytes };
  }

  return null;
}

/**
 * 改 prompt 时必须先归档 —— 否则历史计划的追溯链会断。
 *
 * ## 为什么要在写之前检查，而不是事后 `--check` 报错
 *
 * 事后报错意味着「发现时已经断了」。而断了之后**没法补**：旧字节如果没留，
 * 谁也不知道当时那份 prompt 长什么样，哈希就成了一个指向空气的指针。
 *
 * 所以这道检查放在 `loadPromptTemplates` 之后、真正调 LLM 之前：
 *   - 当前 prompts/*.txt 的哈希如果不在 archive 里 → 先把它归档
 *   - 归档之后，**任何**历史计划里记的旧哈希也仍然能解析
 *
 * 注意方向：归档的是「现在这份」，不是「历史那份」。历史那份可能早就丢了，
 * 这个函数救不回来 —— 它只保证**今天开始**不会再丢。
 */
export async function archiveCurrentPrompts(dir = "prompts"): Promise<{ added: string[] }> {
  const prompts = await loadPromptTemplates(dir);
  const added: string[] = [];

  // Bun.write 自己会建父目录（项目里 debate.ts 的 persist() 也是这么用的），
  // 所以不需要 node:fs 的 mkdir —— 少一个 import，也少一处平台差异。
  for (const name of PROMPT_NAMES) {
    const t = prompts[name];
    const dest = `${dir}/archive/${t.keccak256}.txt`;
    if (await Bun.file(dest).exists()) continue;
    await Bun.write(dest, t.text);
    added.push(`${t.keccak256}.txt`);
  }
  return { added };
}
