import type { PlanFile } from "./plan-file";

/**
 * 辩论卡片的数据层：把一份计划文件读成「三个 agent + 一个裁决」。
 *
 * 这一块要和 workflow 图区分开：图讲「这条决策怎么走完全程」，
 * 这里讲「AI 到底说了什么」，重点是把 judge 偏离算术平均的那一步摊开。
 *
 * 所有字段都是**文件自述**。页面上的措辞不能越过这条线（README §9.3）。
 */

export type DebateRound = {
  agent: string;
  model: string;
  targetWethBps: number | null;
  confidence: number | null;
  reason: string | null;
};

export type DebateVerdict = {
  model: string;
  targetWethBps: number | null;
  confidence: number | null;
  rationale: string | null;
};

export type DebateView = {
  planId: string;
  displayPath: string;
  size: number;
  asOf: number | null;
  validitySeconds: number | null;
  degraded: boolean | null;
  /** 计划文件里记录的输入快照（AI 当时看到的数，不是现值） */
  input: {
    ethUsd: number | null;
    ethUsd24hPct: number | null;
    btcUsd: number | null;
    btcUsd24hPct: number | null;
    navUsdc: number | null;
    wethBps: number | null;
  } | null;
  rounds: DebateRound[];
  final: DebateVerdict | null;
  /** 三方仓位的算术平均，以及 judge 相对它的偏离 —— 叙事核心 */
  mean: number | null;
  delta: number | null;
};

export type DebateResult = { ok: true; view: DebateView } | { ok: false; reason: string };

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * 读计划文件里的辩论与裁决。
 *
 * `plan` 必须由调用方传入 —— **不要在这里自己判定「哪份是最新」**。
 * 之前这里调 readLatestPlan()（planId 最大），而哈希卡按 keccak 反查到
 * 链上执行的那份，同一屏两条路径读了两份不同文件，数字互相矛盾。
 *
 * 现在全站只有一个判定源：selectCurrentPlan()（onchain 优先）。
 * 调用方拿到那份，传进来；这里只负责解析，不负责挑文件。
 */
export async function readDebate(plan: PlanFile): Promise<DebateResult> {
  if (!plan.json) {
    return {
      ok: false,
      reason: `${plan.displayPath} 解析失败：${plan.parseError ?? "未知原因"}（哈希仍然可算，因为它只吃原始字节）`,
    };
  }

  const json = plan.json;
  const inputObj = obj(json.input);
  const vaultObj = inputObj ? obj(inputObj.vault) : null;
  const finalObj = obj(json.final);

  const rounds: DebateRound[] = (Array.isArray(json.rounds) ? json.rounds : [])
    .map((item) => obj(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      agent: str(item.agent) ?? "?",
      model: str(item.model) ?? "—",
      targetWethBps: num(item.targetWethBps),
      confidence: num(item.confidence),
      reason: str(item.reason),
    }));

  const targets = rounds.map((r) => r.targetWethBps).filter((n): n is number => n !== null);
  const verdictBps = finalObj ? num(finalObj.targetWethBps) : null;

  /**
   * 算术平均保留 1 位小数。
   *
   * 三个 bps 的平均值常是循环小数（3500/1500/1000 → 2000 整除，但 3500/1500/900
   * → 1966.6666…）。不归一会把 466.66666666666674 直接渲染到页面上，
   * 那是浮点数的内部表示，不是给人看的数。
   *
   * 归一到 1 位小数：一是与「bps 是整数单位」的直觉一致，二是 delta 用它相减后
   * 也是干净的 1 位小数，不需要在三个渲染点各补一次 toFixed。
   */
  const round1 = (v: number) => Math.round(v * 10) / 10;
  const meanRaw =
    targets.length > 0 ? targets.reduce((a, b) => a + b, 0) / targets.length : null;
  const mean = meanRaw === null ? null : round1(meanRaw);

  return {
    ok: true,
    view: {
      planId: plan.planId,
      displayPath: plan.displayPath,
      size: plan.size,
      asOf: num(json.asOf),
      validitySeconds: num(json.validitySeconds),
      degraded: typeof json.degraded === "boolean" ? json.degraded : null,
      input: inputObj
        ? {
            ethUsd: num(inputObj.ethUsd),
            ethUsd24hPct: num(inputObj.ethUsd24hPct),
            btcUsd: num(inputObj.btcUsd),
            btcUsd24hPct: num(inputObj.btcUsd24hPct),
            navUsdc: vaultObj ? num(vaultObj.navUsdc) : null,
            wethBps: vaultObj ? num(vaultObj.wethBps) : null,
          }
        : null,
      rounds,
      final: finalObj
        ? {
            model: str(finalObj.model) ?? "—",
            targetWethBps: verdictBps,
            confidence: num(finalObj.confidence),
            rationale: str(finalObj.rationale),
          }
        : null,
      mean,
      delta:
        mean !== null && verdictBps !== null ? round1(verdictBps - mean) : null,
    },
  };
}
