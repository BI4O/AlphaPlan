import type { ChainResult } from "@/lib/chain";
import type { DebateView } from "@/lib/debate";
import type {
  HistoryResult,
  HistoryRow,
  ReconciliationLine,
} from "@/lib/history";
import type { VaultSnapshot } from "@/lib/chain";

/** 五屏共享的同一份数据快照。 */
export type ConsoleData = {
  vault: ChainResult<VaultSnapshot>;
  debate: { ok: true; view: DebateView } | { ok: false; reason: string };
  history: HistoryResult;
  plan: {
    planId: string | null;
    size: number | null;
    reason: string | null;
    /** 链上记录的哈希，与文件哈希对照用 */
    onchainHash: `0x${string}` | null;
    fileHash: `0x${string}` | null;
  };
  /**
   * 「链上执行的那份」与「本地最新的那份」必须分开。
   *
   * 合成一格会出现「链上的哈希 + 另一份文件的大小」这种错配 ——
   * 看起来像数据被篡改，实际只是两份不同的文件。
   */
  planOnchain: PlanSide;
  planLocal: PlanSide;
  /** 本地全部计划文件的哈希，用来识别「拖进来的是哪一份」 */
  allPlanHashes: { planId: string; hash: `0x${string}`; size: number }[];
  chainNodeCount: number;
  /** 本轮时间轴的每一步，来自真实读取过程的实况，不是编的时间戳 */
  timeline: TimelineStep[];
  /** 纪律越界项：真实算出来的，没有就是 0 */
  breaches: Breach[];
};

/** 一份计划文件在某一侧的呈现。 */
export type PlanSide = {
  /** plans/ 里是否有这份文件 */
  present: boolean;
  planId: string | null;
  size: number | null;
  hash: `0x${string}` | null;
  /** 这份文件的哈希是否等于链上 lastPlanHash */
  matchesOnchain: boolean;
  reason: string | null;
};

export type TimelineStep = {
  no: string;
  name: string;
  detail: string;
  state: "done" | "missing" | "issue";
  stateLabel: string;
  /** 没有任何时间信息时留空，绝不编造 */
  time: string | null;
};

export type Breach = {
  label: string;
  value: string;
  limit: string;
};

export type { HistoryRow, ReconciliationLine };
