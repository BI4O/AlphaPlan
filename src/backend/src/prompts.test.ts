import { describe, expect, test } from "bun:test";
import { keccakOf } from "./canonical.ts";
import {
  PROMPT_NAMES,
  archiveCurrentPrompts,
  findPromptByHash,
  loadPromptTemplates,
  resetPromptCache,
  renderAgentUserMessage,
  renderJudgeUserMessage,
  type PromptName,
} from "./prompts.ts";
import { parsePlan, type AgentOpinion } from "./schema.ts";
import { fixturePlan } from "./fixtures.ts";

/**
 * Expected values were produced with an independent implementation:
 *
 *   cast keccak 0x$(xxd -p -c 1000000 prompts/bull.txt | tr -d '\n')
 *
 * NOT with the bare form `cast keccak $(xxd -p …)`, which hashes the ASCII of
 * the hex string rather than the file bytes (see the last test in this file).
 */
const EXPECTED: Record<PromptName, `0x${string}`> = {
  // 2026-10-24 15:16 那一版（去掉了「risk 应当偏向保守」这类写死的立场）
  bull: "0x345570c250d49d35e5b494f36e0ce66a0bfe0825c7329ca4e3bd46c6d8875c40",
  bear: "0x255c3df0f739dde53ee02f00fc6fde562343025fd9495650e61db4eb2a43f893",
  risk: "0xb8421165f59cb79d7f27fe590994864146acd7793eb1329e04ea6b28d14f1c54",
  judge: "0x9454be8abbe5960b1c49151b0c1242e55eba2b82ce81f534c29b461730d739c6",
};

describe("prompt templates are committed files we hash", () => {
  test("all four exist and hash to the recorded values", async () => {
    const templates = await loadPromptTemplates();
    for (const name of PROMPT_NAMES) {
      const template = templates[name];
      expect(template.path).toBe(`prompts/${name}.txt`);
      expect(template.text.length).toBeGreaterThan(200);
      expect(template.keccak256).toBe(EXPECTED[name]!);
    }
    expect(Object.keys(templates).sort()).toEqual([...PROMPT_NAMES].sort());
  });

  test("the hash is over file bytes, not over a re-encoded copy", async () => {
    const file = Bun.file("prompts/bull.txt");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const templates = await loadPromptTemplates();
    expect(templates.bull!.keccak256).toBe(keccakOf(bytes));
    // Re-encoding the text must give the same bytes here (no BOM, no CRLF) —
    // asserted rather than assumed, because a CRLF template would silently
    // hash differently on a Windows checkout.
    expect(keccakOf(new TextEncoder().encode(templates.bull!.text))).toBe(templates.bull!.keccak256);
  });

  test("templates mention the mandate so the band is not carried only by zod", async () => {
    const templates = await loadPromptTemplates();
    for (const name of PROMPT_NAMES) {
      expect(templates[name]!.text).toContain("6000");
      expect(templates[name]!.text).toContain("JSON");
    }
  });
});

describe("rendered messages", () => {
  test("every agent sees the same authoritative input", async () => {
    const plan = fixturePlan();
    const message = renderAgentUserMessage(plan.input);
    const parsed = JSON.parse(message) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["btcUsd", "btcUsd24hPct", "ethUsd", "ethUsd24hPct", "vault"]);
    expect(parsed.ethUsd).toBe(2385.06);
  });

  test("the judge sees the three opinions but not their provenance", () => {
    const plan = fixturePlan();
    const message = renderJudgeUserMessage(plan.input, plan.rounds as AgentOpinion[]);
    const parsed = JSON.parse(message) as { rounds: Array<Record<string, unknown>> };
    expect(parsed.rounds).toHaveLength(3);
    expect(Object.keys(parsed.rounds[0]!).sort()).toEqual(["agent", "confidence", "reason", "targetWethBps"]);
    expect(message).not.toContain("promptTemplateSha");
  });
});

describe("trap: the bare cast keccak form hashes the hex text", () => {
  test("keccak(hex-of-file-as-text) differs from keccak(file bytes)", async () => {
    const bytes = new Uint8Array(await Bun.file("prompts/bull.txt").arrayBuffer());
    const hexText = Buffer.from(bytes).toString("hex");
    const wrong = keccakOf(new TextEncoder().encode(hexText));
    const right = keccakOf(bytes);
    expect(right).toBe(EXPECTED.bull!);
    // 0x42aeb3… is what `cast keccak $(xxd -p …)` returns: a hash of characters.
    expect(wrong).toBe("0x3e5cb74a08ddb7efd0589ccd865b7cd73d365a872acc56953958f4bbe6846107");
    expect(wrong).not.toBe(right);
  });

  test("every prompt would be hashed wrong by the bare form", async () => {
    const templates = await loadPromptTemplates();
    for (const name of PROMPT_NAMES) {
      const bytes = new TextEncoder().encode(templates[name]!.text);
      const wrong = keccakOf(new TextEncoder().encode(Buffer.from(bytes).toString("hex")));
      expect(wrong).not.toBe(templates[name]!.keccak256);
    }
  });
});

describe("offline plan uses the real template hashes", () => {
  test("so a third party can recompute them from the repo", async () => {
    const templates = await loadPromptTemplates();
    const { offlinePlan } = await import("./debate.ts");
    const plan = parsePlan(offlinePlan(1_792_810_800, templates));
    expect(plan.degraded).toBe(true);
    expect(plan.rounds[0]!.promptTemplateSha).toBe(EXPECTED.bull!);
    expect(plan.rounds[1]!.promptTemplateSha).toBe(EXPECTED.bear!);
    expect(plan.rounds[2]!.promptTemplateSha).toBe(EXPECTED.risk!);
    expect(plan.final.promptTemplateSha).toBe(EXPECTED.judge!);
  });
});

describe("prompt byte archive（改 prompt 不能让历史计划失效）", () => {
  // 这一组测的是一个真实事故：2026-10-24 15:16 改了四个 prompt，
  // 之后 8 份历史计划的 promptTemplateSha 全部对不上当前 prompts/，
  // `debate --check` 红 32 项 —— 而那些计划文件本身一个字都没错。
  //
  // 根因：计划只记 hash、不记原文，而 prompts/ 是「当前版本」不是「全部版本」。
  // 修法：prompts/archive/<keccak>.txt —— 文件名就是自己的校验和。

  test("findPromptByHash 能从当前目录按内容找回", async () => {
    const prompts = await loadPromptTemplates("prompts");
    const bull = prompts.bull;
    const found = await findPromptByHash(bull.keccak256, "prompts");
    expect(found).not.toBeNull();
    expect(keccakOf(found!.bytes)).toBe(bull.keccak256);
  });

  test("findPromptByHash 能从 archive 找回已被替换的旧版本", async () => {
    // 这个哈希是 2026-10-24 15:16 **之前**那版 bull.txt。
    // 它已经不在 prompts/bull.txt 里了 —— 只存在于 prompts/archive/ 下。
    const OLD_BULL = "0xceb2a196bb23d0116cc8f56d3664d310e5aa9725998624ff655b7086fc28b1f7" as const;
    const prompts = await loadPromptTemplates("prompts");
    expect(prompts.bull.keccak256).not.toBe(OLD_BULL); // 确认当前确实不是旧那版

    const found = await findPromptByHash(OLD_BULL, "prompts");
    expect(found).not.toBeNull();
    expect(keccakOf(found!.bytes)).toBe(OLD_BULL);
  });

  test("找不到时返回 null，不抛错 —— 校验方需要知道「缺了什么」", async () => {
    const found = await findPromptByHash(`0x${"ab".repeat(32)}`, "prompts");
    expect(found).toBeNull();
  });

  test("archiveCurrentPrompts 幂等：跑两次不会写重复文件", async () => {
    // 用 Bun API 造临时目录，不引 node:fs。
    //
    // 为什么不引：这个仓的 tsconfig 是 `module: "Preserve"`，而它强制
    // `moduleResolution: "bundler"`；"bundler" 下 TS 不解析 `node:` 前缀的
    // CJS 具名导出，于是 `readFileSync` 之类全被推成 `never`（TS2349）。
    // 实测：bundler → 9 个 TS2349，node16/nodenext → 0 个，但换 moduleResolution
    // 要连 `module` 一起换，那是全仓改动。所以测试这边改用 Bun API ——
    // 与仓里其它地方（debate.ts 的 persist）一致。
    //
    // Bun.write 自己建父目录，所以不需要 mkdir。
    const dir = `${Bun.env.TMPDIR ?? "/tmp"}/alphaplan-prompt-archive-${process.pid}`;
    for (const name of ["bull", "bear", "risk", "judge"] as const) {
      await Bun.write(`${dir}/${name}.txt`, await Bun.file(`prompts/${name}.txt`).text());
    }
    resetPromptCache();

    const first = await archiveCurrentPrompts(dir);
    expect(first.added.length).toBe(4);

    resetPromptCache();
    const second = await archiveCurrentPrompts(dir);
    expect(second.added).toEqual([]); // 已经在了，不重复写

    // 归档文件名是**哈希**，不是 agent 名 —— 名字即校验和。
    // 所以要按哈希去找，不能按 bull.txt / bear.txt 去找。
    for (const name of ["bull", "bear", "risk", "judge"] as const) {
      const bytes = new Uint8Array(await Bun.file(`${dir}/${name}.txt`).arrayBuffer());
      const hash = keccakOf(bytes);
      const archived = `${dir}/archive/${hash}.txt`;
      expect(await Bun.file(archived).exists()).toBe(true);
      const back = new Uint8Array(await Bun.file(archived).arrayBuffer());
      expect(keccakOf(back)).toBe(hash);
    }
  });
});
