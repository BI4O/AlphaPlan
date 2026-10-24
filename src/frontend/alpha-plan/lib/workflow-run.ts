import { encodeEventTopics, keccak256 } from "viem";

import { alphaPlanVaultAbi, planEventFieldNames } from "./abi/alphaPlanVault";
import {
  chainName,
  readEthPrice,
  readVaultViews,
  type ChainResult,
  type EthPriceReading,
  type VaultReadings,
} from "./chain";
import { rpcUrl, vaultAddress } from "./env";
import { bps, duration, fixed, isoFromUnix, percentOf, rawBps, shortHex, signedPoints } from "./format";
import { readLatestPlan } from "./plan-file";
import type { WorkflowField, WorkflowModel, WorkflowNode } from "./workflow-types";

/**
 * 把「这次能拿到的证据」拼成 workflow 图的模型。
 *
 * 这一层唯一的职责是**诚实**：每个字段都要能回答「这个数字从哪来」，
 * 拿不到就写清楚缺什么。图上一格都不许出现无来源的数字。
 *
 * 状态是**逐个节点显式判断**出来的，不是一条公式算的 —— 每个节点的
 * `statusReason` 就是那个判断的理由，展开即可自查。
 */

/** PRD §6：cron 必须是六段；五段会被 CRE 拒绝。这是规范值，不是采集值。 */
const CRON_SPEC = "0 */10 * * * *";

// —— 计划文件里的字段都是「自述」，读取时按不可信处理 ——

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

type Round = {
  agent: string;
  model: string;
  targetWethBps: number | null;
  confidence: number | null;
  reason: string | null;
};

function readRounds(plan: Record<string, unknown>): Round[] {
  return asArray(plan.rounds)
    .map((item) => {
      const round = asObject(item);
      if (!round) return null;
      return {
        agent: asString(round.agent) ?? "?",
        model: asString(round.model) ?? "—",
        targetWethBps: asNumber(round.targetWethBps),
        confidence: asNumber(round.confidence),
        reason: asString(round.reason),
      };
    })
    .filter((round): round is Round => round !== null);
}

function unavailable(label: string, missing: string): WorkflowField {
  // 值给「—」而不是「未采集」：右边还有一枚 source chip 写着未采集，重复两遍读起来更糟。
  return { label, value: "—", source: "unavailable", note: missing };
}

/** 计划文件里的 degraded 是自述值；读不到就是 null，不猜。 */
function readDegraded(plan: Record<string, unknown> | null): boolean | null {
  return plan && typeof plan.degraded === "boolean" ? plan.degraded : null;
}

// —— 节点 1：CRON 触发 ——

function cronNode(): WorkflowNode {
  return {
    id: "cron",
    row: 1,
    col: 1,
    arrow: "right",
    title: "CRON 触发",
    subtitle: "每 10 分钟",
    status: "unavailable",
    statusReason:
      "src/backend/cre/ 尚未生成（P3 未交付），没有任何触发记录可读 —— 下面那行表达式是规范值，不是采集值。",
    summary: "表达式来自 PRD，无触发记录",
    fields: [
      {
        label: "cron（六段）",
        value: CRON_SPEC,
        source: "spec",
        note: "PRD §6 规定；5 段会被 CRE 拒绝。实际配置应以 src/backend/cre/ 为准，该目录还不存在。",
      },
      unavailable("上次触发时间", "需要 workflow 运行记录或 PlanExecuted 事件"),
      unavailable("trigger 输出", "CRE simulate 日志未落盘"),
    ],
  };
}

// —— 节点 2：EVM READ ——

function readNode(
  feed: ChainResult<EthPriceReading>,
  vault: ChainResult<VaultReadings>,
  plan: Record<string, unknown> | null,
): WorkflowNode {
  const fields: WorkflowField[] = [];

  if (feed.ok) {
    fields.push({
      label: "ethPrice",
      value: `$${fixed(feed.value.priceUsd, 2)}`,
      source: "chain",
      note:
        `Chainlink ETH/USD · 8 位小数 · 更新于 ${isoFromUnix(feed.value.updatedAt)}` +
        `（${duration(feed.value.ageSeconds)} 前）` +
        (feed.value.stale ? " · 已超过合约的 1h 陈旧阈值，totalAssets() 会 revert" : ""),
    });
  } else {
    fields.push(unavailable("ethPrice", `RPC 读失败：${feed.reason}`));
  }

  if (vault.ok) {
    fields.push({
      label: "totalAssets",
      value: `${fixed(vault.value.totalAssetsUsdc, 4)} USDC`,
      source: "chain",
      note: `金库 ${vault.value.address}`,
    });
    fields.push({
      label: "currentWethBps",
      value: `${percentOf(vault.value.currentWethBps)}（${rawBps(vault.value.currentWethBps)}）`,
      source: "chain",
      note: "合约的当前仓位，不是计划里的目标值。",
    });
  } else {
    fields.push(unavailable("totalAssets", vault.reason));
    fields.push(unavailable("currentWethBps", vault.reason));
  }

  // 计划文件里记的是 AI 当时看到的输入快照 —— 必须和现值分开标。
  const planVault = plan ? asObject(asObject(plan.input)?.vault) : null;
  const navUsdc = planVault ? asNumber(planVault.navUsdc) : null;
  const wethBps = planVault ? asNumber(planVault.wethBps) : null;
  if (navUsdc !== null || wethBps !== null) {
    fields.push({
      label: "计划文件记载",
      value: `NAV ${fixed(navUsdc, 4)} USDC · WETH ${bps(wethBps)}`,
      source: "plan-file",
      note: `asOf ${isoFromUnix(plan ? asNumber(plan.asOf) : null)} 时刻的输入快照，不是现值。`,
    });
  }

  const chainReads = fields.filter((field) => field.source === "chain").length;
  return {
    id: "read",
    row: 1,
    col: 2,
    arrow: "right",
    title: "EVM READ",
    subtitle: "链上读取",
    status: vault.ok ? "done" : "partial",
    statusReason: vault.ok
      ? "ETH/USD 与金库视图都在这次请求里读到了。"
      : "ethPrice 是这次实时读的；金库两个视图缺 VAULT_ADDRESS，所以这格只算部分采集。",
    summary: vault.ok ? `${chainReads} 项实时读取` : `${chainReads}/3 项实时读取`,
    fields,
  };
}

// —— 节点 3：HTTP 取计划 ——

function fetchNode(planFile: PlanFileLike | null, reason: string | null): WorkflowNode {
  if (!planFile) {
    return {
      id: "fetch",
      row: 1,
      col: 3,
      arrow: "right",
      title: "HTTP 取计划",
      subtitle: "plans/<id>.json",
      status: "unavailable",
      statusReason: reason ?? "没有可读的计划文件。",
      summary: "未采到计划文件",
      fields: [unavailable("计划文件", reason ?? "需要 plans/<planId>.json")],
    };
  }

  const plan = planFile.json;
  const asOf = plan ? asNumber(plan.asOf) : null;
  const validity = plan ? asNumber(plan.validitySeconds) : null;
  const degraded = readDegraded(plan);

  const fields: WorkflowField[] = [
    {
      label: "文件",
      value: planFile.displayPath,
      source: "plan-file",
      note: `修改于 ${planFile.modifiedAt.toISOString()} · PLANS_DIR=${process.env.PLANS_DIR ?? "../../backend/plans"}`,
    },
    { label: "字节数", value: `${planFile.size} B`, source: "plan-file" },
  ];

  if (asOf !== null) {
    fields.push({ label: "asOf", value: isoFromUnix(asOf), source: "plan-file", full: String(asOf) });
  }
  if (validity !== null) {
    fields.push({
      label: "validitySeconds",
      value: `${validity}s`,
      source: "plan-file",
      note: "validUntil = asOf + validitySeconds。合约以 validUntil 为主约束拒过期计划，MAX_PLAN_AGE 只是兜底。",
    });
  }
  if (degraded !== null) {
    fields.push({
      label: "degraded",
      value: String(degraded),
      source: "plan-file",
      note: degraded
        ? "文件自述为降级计划 —— 按机制约定不得上链（workflow 前置门拦截，ACCEPTANCE C10）。注意这也是自述：手写 false 无法被识别。"
        : "文件自述未降级。同样是自述，不是证明。",
    });
  }
  if (planFile.parseError) {
    fields.push({
      label: "解析",
      value: "失败",
      source: "derived",
      note: `JSON 解析失败：${planFile.parseError} —— 哈希仍然可以算，因为它只吃原始字节。`,
    });
  }

  return {
    id: "fetch",
    row: 1,
    col: 3,
    arrow: "right",
    title: "HTTP 取计划",
    subtitle: "plans/<id>.json",
    status: "done",
    statusReason: `文件在磁盘上，${planFile.size} 字节，已按原始字节交出（没有 parse 后再序列化）。`,
    summary: `${planFile.size} B${degraded === true ? " · degraded" : ""}`,
    fields,
  };
}

// —— 节点 4：KECCAK ——

function hashNode(planFile: PlanFileLike | null, degraded: boolean | null): WorkflowNode {
  if (!planFile) {
    return {
      id: "hash",
      row: 1,
      col: 4,
      arrow: "down",
      title: "KECCAK 哈希",
      subtitle: "对原始字节",
      status: "unavailable",
      statusReason: "没有文件就没有哈希。",
      summary: "未计算",
      fields: [unavailable("planHash", "需要计划文件")],
    };
  }

  const planHash = keccak256(planFile.bytes);

  return {
    id: "hash",
    row: 1,
    col: 4,
    arrow: "down",
    title: "KECCAK 哈希",
    subtitle: "对原始字节",
    status: "done",
    statusReason:
      "本地对文件原始字节算出了 keccak256。链上没有 planHash 可对照 —— 那需要一次真实执行。",
    summary: shortHex(planHash),
    fields: [
      {
        label: "planHash（本地算）",
        value: shortHex(planHash),
        full: planHash,
        source: "derived",
        note: "直接对 readFile 的 bytes 取 keccak256。不经过 JSON.parse/stringify —— 那会改键序与空格，链上立刻对不上（ACCEPTANCE 陷阱 4）。",
      },
      unavailable(
        "链上 planHash",
        degraded === true
          ? "需要 PlanExecuted / PlanRecorded 事件；这份计划 degraded: true，按约定不会上链"
          : degraded === false
            ? "需要 PlanExecuted / PlanRecorded 事件；计划未降级，但还没有广播（P4 未交付）"
            : "需要 PlanExecuted / PlanRecorded 事件",
      ),
      {
        label: "算法",
        value: "keccak256",
        source: "spec",
        note: "EVM 原生 keccak，不是 SHA3-256：两者 padding 不同，结果不能互换。",
      },
    ],
  };
}

// —— 节点 7（回程第三格，视觉第三列）：AI 共识 ——

function aiNode(plan: Record<string, unknown> | null): WorkflowNode {
  const rounds = plan ? readRounds(plan) : [];
  const final = plan ? asObject(plan.final) : null;
  const fields: WorkflowField[] = [];

  for (const round of rounds) {
    fields.push({
      label: round.agent,
      value: `${percentOf(round.targetWethBps)}（${rawBps(round.targetWethBps)}）· 信心 ${round.confidence ?? "—"}（自评）· ${round.model}`,
      source: "plan-file",
      note: round.reason ?? undefined,
    });
  }

  const finalBps = final ? asNumber(final.targetWethBps) : null;
  const finalConfidence = final ? asNumber(final.confidence) : null;
  const rationale = final ? asString(final.rationale) : null;

  if (finalBps !== null) {
    fields.push({
      label: "judge",
      value: `${percentOf(finalBps)}（${rawBps(finalBps)}）· 信心 ${finalConfidence ?? "—"}（自评）· ${asString(final?.model) ?? "—"}`,
      source: "plan-file",
      note: rationale ?? undefined,
    });
  }

  // 「为什么不是算术平均」用文件里的真实数字现算，不背台词。
  const values = rounds
    .map((round) => round.targetWethBps)
    .filter((value): value is number => value !== null);
  if (values.length > 0 && finalBps !== null) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const delta = finalBps - mean;
    fields.push({
      label: "vs 算术平均",
      value: `${percentOf(mean)} → ${percentOf(finalBps)}（${signedPoints(delta)}）`,
      source: "derived",
      note: "由文件里三方 targetWethBps 现算。偏离本身不是卖点：judge 的 rationale 必须说清它为什么不信某一方。",
    });
  }

  return {
    id: "ai",
    row: 2,
    col: 3,
    arrow: "left",
    title: "AI 共识",
    subtitle: "bull · bear · risk → judge",
    status: rounds.length > 0 ? "done" : "unavailable",
    statusReason:
      rounds.length > 0
        ? `${rounds.length} 个 agent 的意见与 judge 裁决全部来自计划文件。注意是自述，不是 zkML 证明。`
        : "计划文件里读不到 rounds，或那是一份 offline 样例。",
    summary: rounds.length > 0 ? `${rounds.length} agent + judge` : "未采集",
    fields:
      fields.length > 0 ? fields : [unavailable("agent 意见", "需要 plans/<id>.json 里的 rounds / final")],
  };
}

// —— 节点 6（回程第二格）：3 门禁 ——

function gateNode(plan: Record<string, unknown> | null): WorkflowNode {
  const degraded = readDegraded(plan);

  const degradedField: WorkflowField =
    degraded === null
      ? unavailable("degraded 门", "需要计划文件里的 degraded 字段")
      : {
          label: "degraded 门",
          value: degraded ? "拒绝（推断）" : "通过（推断）",
          source: "derived",
          note:
            "推断依据是文件自述的 degraded 值。门禁代码在 src/backend/cre/（P3 未交付），" +
            "还没有日志能证明它跑过；ACCEPTANCE C10 要求这道门先于 planUsed 判定。",
        };

  const status = degraded === true ? "blocked" : degraded === false ? "partial" : "unavailable";

  return {
    id: "gate",
    row: 2,
    col: 2,
    arrow: "left",
    title: "3 门禁",
    subtitle: "degraded · planUsed · nonce",
    status,
    statusReason:
      degraded === true
        ? "文件自述 degraded: true —— 按机制约定这道门会拒绝，所以这条计划走不到 EVM WRITE。这就是没有 tx 的原因。"
        : degraded === false
          ? "degraded 门按文件自述会通过；另外两道门（planUsed / nonce）要读链上状态，当前没有执行可读，所以只算部分判定。"
          : "门禁需要链上状态（planUsed / lastNonce）才能判定，当前没有可读的执行。",
    summary:
      degraded === true
        ? "被 degraded 门拦下"
        : degraded === false
          ? "degraded 门通过 · 链上两门未采集"
          : "未采集",
    fields: [
      degradedField,
      unavailable("planUsed 门", "需要链上 planUsed(planHash)，而 planHash 未上链"),
      unavailable("nonce 门", "需要链上 lastNonce"),
    ],
  };
}

// —— 节点 5（回程第一格，视觉第一列）：EVM WRITE ——

function writeNode(degraded: boolean | null): WorkflowNode {
  // topic0 由 ABI 现算：它能证明仓库 ABI 与要审计的事件签名一致，不需要部署。
  const topics = encodeEventTopics({ abi: alphaPlanVaultAbi, eventName: "PlanExecuted" });
  const topic0 = topics[0];

  return {
    id: "write",
    row: 2,
    col: 1,
    arrow: null,
    title: "EVM WRITE",
    subtitle: "onReport → forwarder",
    status: "unavailable",
    statusReason:
      degraded === true
        ? "没有 PlanExecuted / PlanRecorded 事件可展示：这份计划 degraded: true，被前置门拦下，没有广播。"
        : "没有 PlanExecuted / PlanRecorded 事件可展示：计划本身没被拦，但 P4 还没有部署广播。",
    summary: "无执行",
    fields: [
      unavailable("txHash", degraded === true ? "这份计划不会上链（degraded），没有 tx" : "需要一笔真实广播；P4 未交付"),
      unavailable("PlanExecuted 事件", "同上"),
      {
        label: "topic0",
        value: shortHex(topic0),
        full: topic0,
        source: "spec",
        note: "由仓库 ABI 现算（encodeEventTopics），不是采集值：它只能证明 ABI 与事件签名一致，不能证明事件发生过。",
      },
      {
        label: "事件字段",
        value: planEventFieldNames.join(", "),
        source: "spec",
        note: "asOf / validUntil 就是为 E4 ②③ 加的两个字段（contract-worker 已合并）。",
      },
      {
        label: "非计划交易",
        value: "LiquiditySold",
        source: "spec",
        note:
          "赎回时现金不足，合约会自动卖 WETH 并发 LiquiditySold（topic0 0xc1ce2ec3… 已核对，签名里 timestamp 是 uint64）" +
          "。它不经过这张图的任何节点 —— 所以历史里必须单独成一列，否则持仓变了却在日志里找不到对应交易。",
      },
    ],
  };
}

type PlanFileLike = {
  displayPath: string;
  size: number;
  modifiedAt: Date;
  bytes: Uint8Array;
  json: Record<string, unknown> | null;
  parseError: string | null;
};

export async function buildWorkflowModel(): Promise<WorkflowModel> {
  const [planRead, feed, vault] = await Promise.all([
    readLatestPlan().catch((error: unknown) => ({
      ok: false as const,
      reason: error instanceof Error ? (error.message.split("\n")[0] ?? error.name) : String(error),
    })),
    readEthPrice(),
    readVaultViews(),
  ]);

  const planFile = planRead.ok ? (planRead.plan as PlanFileLike) : null;
  const planJson = planFile?.json ?? null;
  const reason = planRead.ok ? null : planRead.reason;
  const degraded = readDegraded(planJson);

  const nodes: WorkflowNode[] = [
    cronNode(),
    readNode(feed, vault, planJson),
    fetchNode(planFile, reason),
    hashNode(planFile, degraded),
    aiNode(planJson),
    gateNode(planJson),
    writeNode(degraded),
  ];

  const provenance: string[] = [];
  if (planFile) {
    provenance.push(
      `${planFile.displayPath}（${planFile.size} B，修改于 ${planFile.modifiedAt.toISOString()}）` +
        (degraded === null ? "" : degraded ? "，degraded: true" : "，degraded: false"),
    );
  } else {
    provenance.push("计划文件未采集");
  }
  provenance.push(feed.ok ? `ETH/USD 本次实时读取（${duration(feed.value.ageSeconds)} 前更新）` : "ETH/USD 未读到");
  provenance.push(vault.ok ? `金库 ${chainName()} 实时读取` : "金库视图未采集（缺 VAULT_ADDRESS）");

  const warnings: string[] = [];
  if (degraded === true) {
    warnings.push(
      "这份计划 degraded: true —— 按机制约定不会上链。所以没有 txHash、没有事件、链上 planHash 无处对照。这不是页面缺陷，是它被拦下的证据。",
    );
  }
  if (!vault.ok) {
    warnings.push(`金库视图读不到：${vault.reason}（RPC ${rpcUrl()}；配好 VAULT_ADDRESS 后这格会自己亮）。`);
  }
  if (feed.ok && feed.value.stale) {
    warnings.push(
      `ETH/USD 已 ${duration(feed.value.ageSeconds)} 未更新（合约阈值 1h）—— 现在调 totalAssets() 会 revert。`,
    );
  }
  if (!feed.ok) warnings.push(`ETH/USD 读失败：${feed.reason}`);
  if (planFile?.parseError) {
    warnings.push(`计划文件 JSON 解析失败（${planFile.parseError}）—— 哈希仍然有效，因为它只吃原始字节。`);
  }
  if (vaultAddress() === null) {
    warnings.push(
      "VAULT_ADDRESS 是 P4 的交付物。前端读三个环境变量：RPC_URL（默认 sepolia.base.org）、VAULT_ADDRESS、PLANS_DIR（默认 ../../backend/plans）。",
    );
  }

  return { nodes, provenance: provenance.join(" · "), warnings };
}
