import { percentOf, signedPoints } from "@/lib/format";

import type { ConsoleData } from "./types";

/**
 * 执行链路的「演示」脚本 —— 11 个节点，一步一步讲。
 *
 * 三条纪律，和其他屏一致：
 *
 * 1. **字幕里的每个数字都来自 data**，不在这里写死。
 *    节点上的 meta 只放得下一短句；字幕补的是「这一步在做什么、为什么重要」，
 *    以及那个短句装不下的量（比如 totalAssets 的具体读数）。
 * 2. **读不到就写「未采集」并说明为什么**，不写 0、不猜。
 *    cron 的触发时刻、门禁的内部判定都属于这一类。
 * 3. **不评价、不夸张**。「这是关键」「非常安全」这类词不进字幕 ——
 *    观众要自己判断，替他说了就成了宣传片。
 *
 * 为什么单独一个文件：chain.tsx 里那份节点表还要被画布、抽屉、图例共用，
 * 把 11 段文案塞进去会让那个文件从 700 行涨到 900 行，而这块只服务演示。
 */

export type WalkthroughStep = {
  /** 对应 WfNode.id，用来决定运镜目标与高亮 */
  nodeId: string;
  /** 字幕第一行：这一步叫什么 */
  title: string;
  /** 字幕正文：用 data 拼出来的一句话 */
  body: string;
  /**
   * 这一格有没有真的读数。
   * false 的步骤字幕末尾会自动补一句「为什么读不到」——
   * 不做这件事的话，观众会以为「未采集」是页面坏了。
   */
  hasValue: boolean;
};

export type WalkthroughScript = {
  steps: WalkthroughStep[];
};

/**
 * 偏离量。与 chain.tsx 的 fmtDeviation 同源（都走 `signedPoints`）——
 * 同一屏里节点 meta 与字幕显示的偏离必须一模一样，包括「0 不写符号」这条。
 */
function fmtDeviation(dev: number): string {
  return signedPoints(dev);
}

/** `0x1234…abcd` —— 与画布上节点 meta 的截断方式一致，避免同一屏两种写法。 */
function short(h: string | null | undefined): string {
  if (!h) return "未采集";
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

/**
 * 把 data 编译成 11 步字幕。
 *
 * 每次进入演示时重算一次 —— 因为 data 是服务端快照，
 * 页面刷新后链上状态可能已经变了（比如计划刚上链），
 * 把文案在模块加载时算死会讲到上一轮的读数。
 */
export function buildWalkthrough(data: ConsoleData): WalkthroughScript {
  const vault = data.vault.ok ? data.vault.value : null;
  const debate = data.debate.ok ? data.debate.view : null;
  const exec = data.history.ok
    ? ([...data.history.rows]
        .reverse()
        .find((r) => r.kind === "PlanExecuted" || r.kind === "PlanRecorded") ?? null)
    : null;

  // rounds[] 里的 agent 是 "bull" / "bear" / "risk"，与画布节点 id 同名
  const bpsOf = (agent: string) => {
    if (!debate) return null;
    const r = debate.rounds.find((x) => x.agent === agent);
    return r ? r.targetWethBps : null;
  };
  const fmtBps = (v: number | null) => (v === null ? null : percentOf(v));

  const bull = bpsOf("bull");
  const bear = bpsOf("bear");
  const risk = bpsOf("risk");
  const final = debate?.final?.targetWethBps ?? null;
  const mean = debate?.mean ?? null;

  const steps: WalkthroughStep[] = [
    {
      nodeId: "cron",
      title: "定时触发",
      body: "CRE workflow 每 10 分钟被唤起一次。",
      hasValue: false,
    },
    {
      nodeId: "read",
      title: "读取金库余额",
      body: vault
        ? `viem 直读金库合约，在区块 ${vault.blockNumber.toString()} 读到：总资产 ${vault.totalAssets.toFixed(2)} ${vault.assetSymbol}，WETH 占比 ${percentOf(vault.currentWethBps)}。这是读取时刻的快照，不是执行发生的那一刻。`
        : `读不到金库：${data.vault.ok ? "未知原因" : data.vault.reason}`,
      hasValue: Boolean(vault),
    },
    {
      nodeId: "http",
      title: "取回计划字节",
      body:
        data.plan.size === null
          ? "没有取到计划文件。"
          : `从 plans/ 取 ${data.plan.planId}，${data.plan.size} 字节。取的是原始字节，不解析、不重排。`,
      hasValue: data.plan.size !== null,
    },
    {
      nodeId: "hash",
      title: "keccak256",
      body:
        data.plan.fileHash === null
          ? "没有文件就算不出哈希。"
          : `对原始字节算 keccak256，得到 ${short(data.plan.fileHash)}。这一步之后，内容改一个字节哈希就全变。`,
      hasValue: data.plan.fileHash !== null,
    },
    {
      nodeId: "bull",
      title: "看多 agent",
      body:
        bull === null
          ? "没有读到看多的报价。"
          : `看多给出 ${fmtBps(bull)} 的 ETH 占比。三个 agent 各自独立发言，互不参考。`,
      hasValue: bull !== null,
    },
    {
      nodeId: "bear",
      title: "看空 agent",
      body:
        bear === null
          ? "没有读到看空的报价。"
          : `看空给出 ${fmtBps(bear)}。与看多 ${fmtBps(bull) ?? "—"} 分列，没有先商量。`,
      hasValue: bear !== null,
    },
    {
      nodeId: "risk",
      title: "风控 agent",
      body:
        risk === null
          ? "没有读到风控的报价。"
          : `风控给出 ${fmtBps(risk)}。它的上限是合约里的 60%，超出会被门禁拦下。`,
      hasValue: risk !== null,
    },
    {
      nodeId: "judge",
      title: "裁决 · 不取平均",
      body:
        final === null || mean === null
          ? "没有读到裁决。"
          : `算术平均是 ${percentOf(mean)}，裁决取 ${fmtBps(final)}，偏离 ${fmtDeviation(final - mean)}。judge 有权偏离均值，但偏离量必须写出来。`,
      hasValue: final !== null,
    },
    {
      nodeId: "gate",
      title: "门禁",
      body: exec
        ? "这一步没有读数可看 —— 前端读不到门禁的逐项判定过程。能确定的是它放行了，因为下面有执行事件。"
        : "没有执行事件，也就无法推断门禁是否放行过。",
      hasValue: false,
    },
    {
      nodeId: "write",
      title: "写链",
      body: exec
        ? `把计划提交到金库合约，交易进入区块 ${exec.blockNumber}，nonce ${exec.nonce ?? "未采集"}。${
            vault
              ? exec.blockNumber < Number(vault.blockNumber)
                ? `这是执行时刻，早于第 2 步读到的区块 ${vault.blockNumber.toString()}。`
                : `第 2 步读到的区块是 ${vault.blockNumber.toString()}，与这里是同一个块。`
              : ""
          }`
        : "链上还没有写入过任何计划。",
      hasValue: Boolean(exec),
    },
    {
      nodeId: "receipt",
      /*
        三种状态，不是两种。
        之前写 `exec?.kind === "PlanRecorded" ? "PlanRecorded" : "PlanExecuted"` ——
        exec 为 null 时落进了 else，于是「链上什么都没有」这一格被标成 PlanExecuted。
        那是在陈述一个不存在的事件。
      */
      title: !exec
        ? "执行事件"
        : exec.kind === "PlanRecorded"
          ? "PlanRecorded"
          : "PlanExecuted",
      /*
        两个事件说的是两件事，不能一句话带过：
          PlanExecuted → 真的调仓了
          PlanRecorded → 通过了门禁，但偏差在容差内，所以只记账、不交易
        之前这里一律写「计划确实被执行过」，对 PlanRecorded 是错的。
      */
      body: !exec
        ? "没有执行事件。整条链路走完了前面的步骤，但还没有走到链上。"
        : exec.kind === "PlanRecorded"
          ? `事件落库，交易哈希 ${short(exec.txHash)}。回执类型是 PlanRecorded —— 计划通过了门禁，但目标仓位与当前仓位的偏差在容差内，所以只记账、没有真的调仓。这也是链上凭据，只是它证明的是「决定不动」而不是「动了」。`
          : `事件落库，交易哈希 ${short(exec.txHash)}。回执类型是 PlanExecuted —— 计划通过了门禁，并且真的按目标仓位调了仓。前面的每一句话，到这里才第一次有了链上凭据。`,
      hasValue: Boolean(exec),
    },
  ];

  return { steps };
}

/**
 * 「为什么读不到」——只在 hasValue 为 false 的步骤上出现。
 *
 * 单独一个函数而不是写进 body，是因为这 11 步里只有固定几种缺失原因，
 * 写在一起可以保证口径统一（比如 cron 那条永远说「由外部调度」，
 * 不会第 1 步说「外部调度」、第 9 步说「没有数据」）。
 */
export function missingReason(nodeId: string): string | null {
  switch (nodeId) {
    case "cron":
      return "cron 由外部调度器触发，触发时刻不在本页的读取范围内。";
    case "gate":
      return "门禁的逐项判定与上限值都在合约内部，前端没有事件可读。";
    case "write":
    case "receipt":
      return "链上还没有出现过计划事件。";
    default:
      return null;
  }
}
