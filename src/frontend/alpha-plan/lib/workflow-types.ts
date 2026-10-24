/**
 * workflow 图的纯类型 —— 客户端组件只依赖这一份，不碰服务端代码。
 *
 * 每个字段都带 `source`，因为这张图的存在意义就是「数据从哪来」：
 * 卡片上没有无来源的数字。
 */

export type FieldSource =
  /** 链上真实读（这次请求时读的） */
  | "chain"
  /** 计划文件里记载的（asOf 时刻的快照，不是现值） */
  | "plan-file"
  /** 规范里写死的值（PRD / 合约源码），不是某次执行的采集 */
  | "spec"
  /** 由上面几类推断出来的结论（会明确标「推断」） */
  | "derived"
  /** 拿不到：写明缺什么 */
  | "unavailable";

export type NodeStatus =
  /** 该节点的产出齐了，且能核对 */
  | "done"
  /** 有数据，但被某道门禁拦下（例如 degraded） */
  | "blocked"
  /** 有部分数据，另一部分缺来源（图上会比 done 淡、比 unavailable 实） */
  | "partial"
  /** 没有数据源 */
  | "unavailable";

export type WorkflowField = {
  label: string;
  value: string;
  source: FieldSource;
  /** 完整值（卡片上被截断的东西放这里，用 title 展示） */
  full?: string;
  note?: string;
};

export type WorkflowNode = {
  id: "cron" | "read" | "fetch" | "hash" | "ai" | "gate" | "write";
  /** 布局：蛇形两行，4 列 */
  row: 1 | 2;
  col: 1 | 2 | 3 | 4;
  /** 卡片之间的小箭头方向（左行右指，回程行左指，折返处向下） */
  arrow: "right" | "left" | "down" | null;
  title: string;
  subtitle: string;
  status: NodeStatus;
  /** 为什么是这个状态 —— 展开就能看到的判断理由，不写在代码注释里 */
  statusReason: string;
  summary: string;
  fields: WorkflowField[];
};

export type WorkflowModel = {
  nodes: WorkflowNode[];
  /** 图上那行小字：由事实拼出来，不是写死的宣传语 */
  provenance: string;
  /** 需要点名提醒的事实（缺什么、哪一步被拦） */
  warnings: string[];
};
