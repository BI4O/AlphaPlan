import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * 计划文件读取（服务端）。
 *
 * 两条铁律：
 *   1. 哈希算的是**原始字节**，所以这里同时交出 `bytes` 和 `json`，
 *      谁也别指望「parse 完再 stringify」能对得上（ACCEPTANCE 陷阱 4）。
 *   2. 找不到文件不是异常，是一种要显示出来的状态 —— 页面不该白屏。
 */

/** PRD §7.2 的 planId 形状。既用来挑文件，也用来挡住路径穿越。 */
export const PLAN_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const MAX_PLAN_BYTES = 1024 * 1024;

export function plansDir(): string {
  // 计划文件在 frontend 之外（默认 ../../backend/plans），Turbopack 静态分析推不出来，
  // 于是会把整个项目 trace 进输出（构建变慢、部署超限）。我们不用 standalone 输出，
  // 运行时直接从磁盘读，所以这里显式关掉这次 trace。
  // 反过来说：哪天改成 output: 'standalone'，PLANS_DIR 必须挂进容器。
  return path.resolve(
    /* turbopackIgnore: true */
    process.cwd(),
    process.env.PLANS_DIR ?? "../../backend/plans",
  );
}

export type PlanFile = {
  planId: string;
  /** 绝对路径（只在服务端用，别透给浏览器） */
  absolutePath: string;
  /** 相对仓库的可读路径，给图上的「数据来自哪里」用 */
  displayPath: string;
  bytes: Uint8Array;
  size: number;
  modifiedAt: Date;
  /** 原始文本，仅在解析失败时用来标记 */
  parseError: string | null;
  json: Record<string, unknown> | null;
};

export type PlanRead = { ok: true; plan: PlanFile } | { ok: false; reason: string };

/**
 * 「哪份是当前计划」的**唯一判定源**。
 *
 * 关键：链上 lastPlanHash 优先。
 *
 * 为什么不能再按 planId 最大来取：
 *   本地的「最新文件」经常是刚生成、还没上链的那份。
 *   而链上执行的是另一份。如果这里按 planId 最大取，辩论卡会显示
 *   一份从未上链的计划，而哈希卡按 keccak 反查到的是真正上链的那份 ——
 *   同一屏里两个来源，互相矛盾，而且看起来像数据错了。
 *
 * 判定顺序：
 *   1. 有 lastPlanHash → 在 plans/ 里找 keccak 匹配的文件（= 链上执行的那份）
 *   2. 找不到 → 退回 planId 最大（并让调用方知道这是「未上链」状态）
 *
 * 与后端 serve-plans.ts 的 `reason: "onchain" | "newest-reportable"` 同口径。
 * 之所以在前端重写一遍而不是调 /latest.json：那个 HTTP 服务（8788）在 demo 里
 * 不一定起着，让一个只读页面依赖它，等于多一个失败点。规则很短，且这里
 * 有测试可依（两处都按「onchain 优先」判）。
 */
export type LatestPlanSelection = {
  plan: PlanFile;
  /** onchain = 就是链上执行的那份；newest-reportable = 链上没匹配到，取的最新本地文件 */
  reason: "onchain" | "newest-reportable";
  onchainHash: string | null;
};

export async function selectCurrentPlan(
  keccakOf: (bytes: Uint8Array) => string,
  onchainHash: string | null,
): Promise<
  | { ok: true; value: LatestPlanSelection }
  | { ok: false; reason: string }
> {
  // 1) onchain 优先
  if (onchainHash) {
    const found = await findPlanByHash(onchainHash, keccakOf);
    if (found?.ok) {
      return {
        ok: true,
        value: { plan: found.plan, reason: "onchain", onchainHash },
      };
    }
  }

  // 2) 退回 planId 最大
  const newest = await readLatestPlan();
  if (!newest.ok) return newest;
  return {
    ok: true,
    value: { plan: newest.plan, reason: "newest-reportable", onchainHash },
  };
}

/** 取目录里 planId 最大的那一份（planId 是 ISO，字典序即时间序）。 */
export async function readLatestPlan(): Promise<PlanRead> {
  const ids = await listPlanIds();
  if (ids.length === 0) {
    return { ok: false, reason: `${plansDir()} 里没有符合 <planId>.json 的文件` };
  }
  return readPlanFile(ids[0]);
}

/**
 * 列出 plans/ 里所有计划文件的 planId（新的在前）。
 *
 * 为什么需要它：链上只有 lastPlanHash 一个值，而本地可能有多份文件
 * （最新生成的那份通常还没上链）。要「按链上哈希反查是哪份文件」，
 * 就得枚举并逐个算 keccak —— 不能只看最新的那一份。
 */
export async function listPlanIds(): Promise<string[]> {
  const dir = plansDir();
  try {
    const names = await readdir(dir);
    return names
      .filter((name) => name.endsWith(".json") && PLAN_ID_PATTERN.test(name.slice(0, -5)))
      .map((name) => name.slice(0, -5))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * 按 keccak 反查「哪一份本地文件是链上那个哈希」。
 *
 * 这是把两件事分开的关键：链上记的是**某一份特定文件**的哈希，
 * 而本地最新的文件往往不是那一份。混在一起就会变成
 * 「链上的哈希配上最新文件的大小」—— 一个恒定显示不一致的假故障。
 */
export async function findPlanByHash(
  hash: string,
  keccakOf: (bytes: Uint8Array) => string,
): Promise<PlanRead | null> {
  const ids = await listPlanIds();
  for (const id of ids) {
    const read = await readPlanFile(id);
    if (!read.ok) continue;
    if (keccakOf(read.plan.bytes).toLowerCase() === hash.toLowerCase()) return read;
  }
  return null;
}

export async function readPlanFile(planId: string): Promise<PlanRead> {
  if (!PLAN_ID_PATTERN.test(planId)) {
    return { ok: false, reason: `planId 形状不合法：${planId}` };
  }

  const dir = plansDir();
  const absolutePath = path.join(dir, `${planId}.json`);

  // 白名单已经挡了 `../`，这里再确认一次解析后的路径没跳出目录（防御性）。
  if (path.dirname(absolutePath) !== dir) {
    return { ok: false, reason: "拒绝读取计划目录之外的文件" };
  }

  try {
    const info = await stat(absolutePath);
    if (!info.isFile()) return { ok: false, reason: `${absolutePath} 不是文件` };
    if (info.size > MAX_PLAN_BYTES) {
      return { ok: false, reason: `${absolutePath} 超过 ${MAX_PLAN_BYTES} 字节，拒绝读取` };
    }

    const buffer = await readFile(absolutePath);
    const bytes = new Uint8Array(buffer);
    const text = buffer.toString("utf8");

    let json: Record<string, unknown> | null = null;
    let parseError: string | null = null;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        json = parsed as Record<string, unknown>;
      } else {
        parseError = "顶层不是对象";
      }
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }

    return {
      ok: true,
      plan: {
        planId,
        absolutePath,
        displayPath: `plans/${planId}.json`,
        bytes,
        size: info.size,
        modifiedAt: info.mtime,
        parseError,
        json,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message.split("\n")[0] ?? message };
  }
}
