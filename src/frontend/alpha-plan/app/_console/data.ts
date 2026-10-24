import { readVaultSnapshot } from "@/lib/chain";
import { readDebate } from "@/lib/debate";
import { readHistory, type HistoryResult } from "@/lib/history";
import {
  findPlanByHash,
  listPlanIds,
  readLatestPlan,
  readPlanFile,
  selectCurrentPlan,
  type PlanRead,
} from "@/lib/plan-file";
import { keccak256 } from "viem";

import type { Breach, ConsoleData, PlanSide, TimelineStep } from "./types";

/**
 * 把四路数据收成一份快照。
 *
 * 顺序有讲究：先读链（拿块号 N），再读事件（toBlock 用同一个 N）—— 否则
 * 「余额读到现在、事件读到刚才」会让对账差一个块的量，看起来像坏账。
 *
 * 失败不抛：每块独立降级，各自带原因。五屏共享这一份，所以一个源挂了
 * 不会让整页白屏，只会让对应屏显示「—」加理由。
 */
/**
 * 链上「最后一条计划记录」的哈希 —— PlanExecuted 与 PlanRecorded 都算。
 *
 * 排序用 nonce，不用块号：nonce 是合约自己的单调计数器，
 * 块号在 fork 上可能因重组/回滚而不可靠。
 */
function pickOnchainPlanHash(history: HistoryResult): `0x${string}` | null {
  if (!history.ok) return null;
  const rows = history.rows.filter(
    (r) => r.kind === "PlanExecuted" || r.kind === "PlanRecorded",
  );
  const latest = rows.reduce<(typeof rows)[number] | null>((best, row) => {
    if (row.planHash === null) return best;
    if (best === null) return row;
    return (row.nonce ?? -1) > (best.nonce ?? -1) ? row : best;
  }, null);
  return (latest?.planHash ?? null) as `0x${string}` | null;
}

export async function loadConsoleData(): Promise<ConsoleData> {
  /*
    顺序是硬要求，不能改回 Promise.all：
      1. 先读链，拿 lastPlanHash
      2. 用它选「当前计划」（onchain 优先）
      3. 用**同一份**计划文件去解析辩论
    之前 debate 和 plan 各读各的（一个按 keccak 反查、一个按 planId 最大），
    同一屏里出现两个来源 —— 哈希卡说 06:49:13Z，辩论卡显示 06:50:32Z 的数字。
  */
  const [vault, history] = await Promise.all([readVaultSnapshot(), readHistory()]);

  // 链上哈希：PlanExecuted ∪ PlanRecorded 里 nonce 最大的那条
  const onchainHash = pickOnchainPlanHash(history);

  // 唯一判定源
  const selection = await selectCurrentPlan((b) => keccak256(b), onchainHash);
  const current = selection.ok ? selection.value : null;
  const planRead: PlanRead = current
    ? { ok: true, plan: current.plan }
    : { ok: false, reason: selection.ok ? "无计划文件" : selection.reason };

  const debate = await readDebate(current ? current.plan : null as never).catch((e) => ({
    ok: false as const,
    reason: e instanceof Error ? e.message : String(e),
  }));

  /*
    开发期断言：辩论卡与哈希卡必须来自同一份文件。
    这两条路径曾经分叉过，而且分叉后页面看起来只是「数字不对」，不报错。
    放进 console.error 里，下次分叉能立刻在日志看见。
  */
  if (process.env.NODE_ENV !== "production" && current) {
    const debatePlanId = debate.ok ? debate.view.planId : null;
    if (debatePlanId !== current.plan.planId) {
      console.error("[plan-source-mismatch]", {
        debatePlanId,
        currentPlanId: current.plan.planId,
        reason: current.reason,
      });
    }
  }

  const planInfo: ConsoleData["plan"] = {
    planId: planRead.ok ? planRead.plan.planId : null,
    size: planRead.ok ? planRead.plan.size : null,
    reason: planRead.ok ? null : planRead.reason,
    onchainHash: null,
    fileHash: null,
  };

  if (planRead.ok) {
    planInfo.fileHash = keccak256(planRead.plan.bytes) as `0x${string}`;
  }

  /**
   * 本地最新那份（planId 最大）—— 和「当前计划」不是一回事。
   *
   * 当前计划由 selectCurrentPlan() 判定，会 onchain 优先。
   * 而这一项要回答的是「本地还有没有更新的、尚未上链的文件」。
   * 混着用会让那份未上链的文件从界面上消失 ——
   * 用户就看不到「有一份新的还没轮到它上链」这个事实。
   */
  const newestLocal = await readLatestPlan();
  const planLocal: PlanSide = {
    present: newestLocal.ok,
    planId: newestLocal.ok ? newestLocal.plan.planId : null,
    size: newestLocal.ok ? newestLocal.plan.size : null,
    hash: newestLocal.ok ? (keccak256(newestLocal.plan.bytes) as `0x${string}`) : null,
    matchesOnchain: false, // 拿到链上哈希后再回填
    reason: newestLocal.ok ? null : newestLocal.reason,
  };

  planInfo.onchainHash = onchainHash;

  /**
   * 按链上哈希反查本地哪一份文件是它。
   *
   * 这就是「不把一格的哈希配上另一格的大小」的实现：链上那份是独立反查出来的，
   * 而不是「假设最新文件就是链上那份」。
   */
  let planOnchain: PlanSide = {
    present: false,
    planId: null,
    size: null,
    hash: planInfo.onchainHash,
    matchesOnchain: false,
    reason: planInfo.onchainHash ? "本地没有与之 keccak 匹配的文件" : "链上没有计划哈希",
  };

  if (planInfo.onchainHash) {
    const found = await findPlanByHash(planInfo.onchainHash, (b) => keccak256(b));
    if (found?.ok) {
      planOnchain = {
        present: true,
        planId: found.plan.planId,
        size: found.plan.size,
        hash: keccak256(found.plan.bytes) as `0x${string}`,
        matchesOnchain: true,
        reason: null,
      };
    }
  }

  planLocal.matchesOnchain =
    planInfo.onchainHash !== null && planLocal.hash === planInfo.onchainHash;

  /**
   * 所有本地计划文件的 keccak。给「拖进来的文件是哪一份」用。
   *
   * 只拿最新那一份的哈希不够：用户可能拖的是三天前的某一份，
   * 那也要被识别成「本地真实存在、只是尚未上链」，而不是「不是链上那份」。
   * 文件数是个位数，逐个算 keccak 的代价可以接受。
   */
  const allPlanHashes: { planId: string; hash: `0x${string}`; size: number }[] = [];
  for (const id of await listPlanIds()) {
    const r = await readPlanFile(id);
    if (!r.ok) continue;
    allPlanHashes.push({
      planId: id,
      hash: keccak256(r.plan.bytes) as `0x${string}`,
      size: r.plan.size,
    });
  }

  const breaches: Breach[] = [];
  if (vault.ok && vault.value.currentWethBps > 6000) {
    breaches.push({
      label: "WETH 仓位",
      value: `${(vault.value.currentWethBps / 100).toFixed(1)} %`,
      limit: "高于上限 60 %",
    });
  }

  const timeline: TimelineStep[] = [
    {
      no: "01",
      name: "定时触发",
      detail: "本地 cron · 每 10 分钟（PRD 规范值，非采集值）",
      state: "missing",
      stateLabel: "未采集",
      time: null,
    },
    {
      no: "02",
      name: "读取金库余额",
      detail: vault.ok ? `区块 ${vault.value.blockNumber} · viem` : vault.reason,
      state: vault.ok ? "done" : "issue",
      stateLabel: vault.ok ? "已读取" : "失败",
      time: null,
    },
    {
      no: "03",
      name: "取回计划字节",
      detail: planRead.ok ? `${planRead.plan.displayPath} · ${planRead.plan.size} B` : planRead.reason,
      state: planRead.ok ? "done" : "issue",
      stateLabel: planRead.ok ? "已读取" : "未找到",
      time: null,
    },
    {
      no: "04",
      name: "keccak256",
      detail: planInfo.fileHash
        ? `${planInfo.fileHash.slice(0, 10)}…${planInfo.fileHash.slice(-6)}`
        : "无文件可算",
      state: planInfo.fileHash ? "done" : "missing",
      stateLabel: planInfo.fileHash ? "已计算" : "未采集",
      time: null,
    },
    {
      no: "05",
      name: "AI 共识",
      detail: debate.ok
        ? `裁决 ${debate.view.final?.targetWethBps ?? "—"} bps · 偏离 ${debate.view.delta ?? "—"}`
        : debate.reason,
      state: debate.ok ? "done" : "issue",
      stateLabel: debate.ok ? "已读取" : "失败",
      time: null,
    },
    {
      no: "06",
      name: "门禁",
      // 前端读不到门禁的判定过程与每项上限。能从「有 PlanExecuted」推出放行过，
      // 但那是推断，如实标注 —— 与画布上的门禁节点保持同一口径。
      detail: history.ok && history.counts.strategy > 0
        ? "放行（由执行事件推断，判定过程未采集）"
        : "合约内判定 · 前端不重算",
      state: "missing",
      stateLabel: "未采集",
      time: null,
    },
    {
      no: "07",
      name: "写链",
      detail: history.ok
        ? `事件区间 ${history.fromBlock} → ${history.toBlock} · ${history.counts.strategy + history.counts.liquidity} 条`
        : history.reason,
      state: history.ok ? "done" : "issue",
      stateLabel: history.ok ? "已读取" : "失败",
      time: null,
    },
  ];

  return {
    vault,
    debate,
    history,
    plan: planInfo,
    planOnchain,
    planLocal,
    allPlanHashes,
    chainNodeCount: 11,
    timeline,
    breaches,
  };
}
