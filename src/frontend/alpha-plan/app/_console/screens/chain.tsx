"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { WalkthroughBar } from "../walkthrough-bar";
import { Icon } from "../icons";
import type { ConsoleData } from "../types";

/* ─────────────────────────── 几何 ─────────────────────────── */

type NodeId =
  | "cron"
  | "read"
  | "http"
  | "hash"
  | "bull"
  | "bear"
  | "risk"
  | "judge"
  | "gate"
  | "write"
  | "receipt"
  | "@group";

/**
 * 节点在画布上占的分量。只用已有 token 表达（描边色 / 底色 / 标签色），不新增颜色：
 *
 *   intake  淡描边 + ash 标签 —— 取数段：最先扫过，不抢眼
 *   agent   同上，但整组落在分组框的淡底里，靠底色成团
 *   judge   indigo 描边 + indigo 标签 —— 全图唯一的重音
 *   commit  ash 描边 + linen 实底 + ink 标签 —— 上链脊柱，比取数段重、比裁决段轻
 *
 * 改之前 11 个节点全是同一张脸（rule 描边 + paper 底），眼睛没有入口：
 * 缩到 78% 以后，一个虚线「未采集」格和一个有真读数的格几乎分不开。
 */
type Tier = "intake" | "agent" | "judge" | "commit";

type WfNode = {
  id: NodeId;
  x: number;
  y: number;
  w: number;
  h: number;
  tag: string;
  title: string;
  meta: string;
  tier: Tier;
  /** 这一格没有读数 → 虚线边框 */
  missing?: boolean;
};

type Side = "left" | "right" | "top" | "bottom";

type Pt = { x: number; y: number };

/**
 * 连线标签的落位方式。所有横向连线的标签都排到节点行上方的「路标带」（基线 y=66）。
 *
 * 为什么不能在连线上：相邻节点之间的缝只有 20px，而 14px 的标签最宽要 90px
 * （PLAN BYTES）。摆在两点中点，必然压住左右两个节点的文字 ——
 * SNAPSHOT / PLAN BYTES / PASS 原来就是这么糊在节点标题上的。
 * 路标带在节点框顶边（76）之上 10px，纵向不与任何节点框相交，所以「不压标题」
 * 是几何保证，不是靠那层 5px 纸色描边去糊（糊不住）。
 *
 *   row       居中于两节点之间的缝，纵向抬到路标带
 *   rowEnd    右端贴住目标框左侧（进分组框的那条）
 *   rowStart  左端贴着来源框右侧（出分组框的那条）
 *   side      竖线右侧，纵向落在上下两段之间的缝中
 *   return    回传线横跑道的左端上方
 */
type LabelPlace = "row" | "rowEnd" | "rowStart" | "side" | "return";

type WfEdge = {
  from: NodeId;
  to: NodeId;
  kind: "primary" | "data" | "loop";
  side: Side;
  toSide: Side;
  fromAt?: number;
  toAt?: number;
  label: string;
  labelPlace: LabelPlace;
  /** 回传线的横跑道 y（stage 坐标） */
  lane?: number;
  /** 回传线的回绕竖线 x —— 落在所有节点左侧，整条线不穿过任何框 */
  wrapX?: number;
};

/**
 * 画布坐标系 1134 × 380。
 *
 * 这两个数是量出来的。1413×807 下：
 *   主区 = 1413 − 侧栏 248 = 1165；内容 padding 32×2 → 1101
 *   .flow 内宽 = 1101 − 面板左右描边 2 = 1099
 *   .flow 高 = clamp(300px, 46vh, 460px)，46vh = 371.2
 *   fit = min(1099 / 1134, 371.2 / 380) = 0.9691
 * —— 14px 的字阶落到屏幕上还有 13.57px，三行文字全在框里。
 * 原来的 1400 × 440 在同一个视口只有 0.783：正文压到 11px、第三行的数字被切掉。
 *
 * 宽高比刻意让「宽度」成为约束（0.9691 < 0.9768）：图横向刚好填满，不左右留空；
 * 纵向只剩 3px 余量，所以上面那行路标带不是浪费，是唯一能放标签的地方。
 */
const VIEW_W = 1134;
const VIEW_H = 380;

/** 节点的统一高度。内容需要 73.1（算法见 console.css 的 .wf-node），余 2.9 */
const ROW_H = 76;
/** 三行的纵坐标。跨列共用同一组 y，所以连线全是水平 / 垂直，没有一条斜线 */
const ROW1_Y = 76;
const ROW2_Y = 174;
const ROW3_Y = 272;
/** 第一行的纵向中心：除了三个 agent 扇入那三条，所有连线都走这条线 */
const ROW_CY = ROW1_Y + ROW_H / 2;
/** 路标带基线：节点框顶边 76 之上 10px，字底 66 与框不接触 */
const BAND_Y = 66;
/** 回传线横跑道的 y：最低的节点到 348，跑道在 356 */
const LANE_Y = 356;
/** 回传线回绕竖线的 x：所有节点都从 x ≥ 13 开始，所以这条竖线不穿过任何框 */
const WRAP_X = 4;

/** 上链脊柱（门禁 / 写链 / PlanExecuted）右对齐到同一条线，右边距与 cron 的左边距相等 */
const COL_RIGHT = 1121;
const COL_W = 184;
const COL_X = COL_RIGHT - COL_W;
const COL_CX = COL_X + COL_W / 2;
const REC_W = 250;
const REC_X = COL_RIGHT - REC_W;

/**
 * 分组框：三个 agent 一行 + 裁决一行。宽 = 左右内边距 10×2 + 3×112 + 缝 8×2 = 372。
 * 左边线与 hash 右边界留 16、右边线与门禁留 16，所以这个框既不压节点、也不被线穿过。
 */
const GROUP = { x: 549, y: 40, w: 372, h: 222, label: "CONSENSUS · 3 AGENT + 1 JUDGE" };
const GROUP_PAD = 10;
const AGENT_W = 112;
const AGENT_GAP = 8;
const AGENT1_X = GROUP.x + GROUP_PAD;
const AGENT2_X = AGENT1_X + AGENT_W + AGENT_GAP;
const AGENT3_X = AGENT2_X + AGENT_W + AGENT_GAP;
/** 三个 agent 的跨距中心 —— 裁决的中心必须对齐到这里，三条扇入线才不歪 */
const AGENT_CX = (AGENT1_X + AGENT3_X + AGENT_W) / 2;
const JUDGE_W = 186;
const JUDGE_X = AGENT_CX - JUDGE_W / 2;

/**
 * 宽度 = 那一格最长一行文字的自然宽度 + 22（左右内边距各 10 + 描边各 1）。
 * 自然宽度按实测字宽推：中文 14px/字，IBM Plex Mono 14px = 8.4px/字符。
 * 每个节点的实际取值与它能容下的最长一行写在该行注释里。
 */
const INITIAL_NODES: WfNode[] = [
  // 最长行 定时触发 56（tag TRIG 37 / meta 未采集 42）→ 78，给 80。
  // 底值虽然总被数据层覆盖（见 withLiveValues），但保留原值作为语义文档
  { id: "cron", x: 13, y: ROW1_Y, w: 80, h: ROW_H, tier: "intake", tag: "TRIG", title: "定时触发", meta: "cron · 每 10 分钟" },
  // 最长行 区块 49500228 ≈ 99.1（标题 读取金库余额 84）→ 121，给 132
  { id: "read", x: 113, y: ROW1_Y, w: 132, h: ROW_H, tier: "intake", tag: "EVM", title: "读取金库余额", meta: "—" },
  // 最长行 200 · 3872 B = 100.8（标题 取回计划字节 84）→ 123，给 130
  { id: "http", x: 265, y: ROW1_Y, w: 130, h: ROW_H, tier: "intake", tag: "HTTP", title: "取回计划字节", meta: "—" },
  // 最长行 0x1f4a…9c02 = 92.4（标题 keccak256 66.6）→ 114，给 118
  { id: "hash", x: 415, y: ROW1_Y, w: 118, h: ROW_H, tier: "intake", tag: "CODE", title: "keccak256", meta: "—" },
  // 最长行 10,000 bps = 84（标题 看多 28）→ 106，给 112
  { id: "bull", x: AGENT1_X, y: ROW1_Y, w: AGENT_W, h: ROW_H, tier: "agent", tag: "AGENT", title: "看多", meta: "—" },
  { id: "bear", x: AGENT2_X, y: ROW1_Y, w: AGENT_W, h: ROW_H, tier: "agent", tag: "AGENT", title: "看空", meta: "—" },
  { id: "risk", x: AGENT3_X, y: ROW1_Y, w: AGENT_W, h: ROW_H, tier: "agent", tag: "AGENT", title: "风控", meta: "—" },
  // 最长行 10,000 bps · -1,234 = 159.6（标题 裁决 · 不取平均 98）→ 182，给 186
  { id: "judge", x: JUDGE_X, y: ROW2_Y, w: JUDGE_W, h: ROW_H, tier: "judge", tag: "JUDGE", title: "裁决 · 不取平均", meta: "—" },
  // 最长行 放行（由执行事件推断）= 154（标题 门禁 28）→ 176，给 184
  { id: "gate", x: COL_X, y: ROW1_Y, w: COL_W, h: ROW_H, tier: "commit", tag: "GATE", title: "门禁", meta: "—" },
  // 最长行 区块 49500228 ≈ 99.1 —— 与门禁同宽，整条脊柱左右对齐
  { id: "write", x: COL_X, y: ROW2_Y, w: COL_W, h: ROW_H, tier: "commit", tag: "EVM", title: "写链", meta: "—" },
  // 最长行 区块 49500228 · 0xd33b…5945 ≈ 207.7（标题 PlanExecuted 88.8）→ 230，给 250
  { id: "receipt", x: REC_X, y: ROW3_Y, w: REC_W, h: ROW_H, tier: "commit", tag: "LOG", title: "PlanExecuted", meta: "—" },
];

/** 分组框边线在「第一行中心」的高度比例 —— 进出分组框的两条线都从这里过，所以是平的 */
const GROUP_EDGE_AT = (ROW_CY - GROUP.y) / GROUP.h;

const EDGES: WfEdge[] = [
  { from: "cron", to: "read", kind: "primary", side: "right", toSide: "left", label: "TRIGGER", labelPlace: "row" },
  { from: "read", to: "http", kind: "primary", side: "right", toSide: "left", label: "SNAPSHOT", labelPlace: "row" },
  { from: "http", to: "hash", kind: "data", side: "right", toSide: "left", label: "PLAN BYTES", labelPlace: "row" },
  // 进分组框：锚点取框左边线在「第一行中心」的高度，所以是一条 16px 的平线，不折
  { from: "hash", to: "@group", kind: "data", side: "right", toSide: "left", toAt: GROUP_EDGE_AT, label: "HASH", labelPlace: "rowEnd" },
  { from: "bull", to: "judge", kind: "data", side: "bottom", toSide: "top", toAt: 0.2, label: "", labelPlace: "row" },
  { from: "bear", to: "judge", kind: "data", side: "bottom", toSide: "top", toAt: 0.5, label: "", labelPlace: "row" },
  { from: "risk", to: "judge", kind: "data", side: "bottom", toSide: "top", toAt: 0.8, label: "", labelPlace: "row" },
  // 出分组框：同样取「第一行中心」，平着落到门禁左侧中点
  { from: "@group", to: "gate", kind: "primary", side: "right", toSide: "left", fromAt: GROUP_EDGE_AT, label: "FINAL", labelPlace: "rowStart" },
  { from: "gate", to: "write", kind: "primary", side: "bottom", toSide: "top", label: "PASS", labelPlace: "side" },
  // 竖轴落在「写链」的中心，再按比例落到 receipt 上 ——
  // 用比例而不是绝对坐标，节点被拖动后锚点仍然跟着框走
  { from: "write", to: "receipt", kind: "data", side: "bottom", toSide: "top", toAt: (COL_CX - REC_X) / REC_W, label: "LOG", labelPlace: "side" },
  {
    from: "receipt",
    to: "cron",
    kind: "loop",
    side: "bottom",
    toSide: "left",
    lane: LANE_Y,
    wrapX: WRAP_X,
    label: "NEXT TRIGGER",
    labelPlace: "return",
  },
];

function anchor(n: { x: number; y: number; w: number; h: number }, side: Side, at = 0.5) {
  if (side === "left") return { x: n.x, y: n.y + n.h * at };
  if (side === "right") return { x: n.x + n.w, y: n.y + n.h * at };
  if (side === "top") return { x: n.x + n.w * at, y: n.y };
  return { x: n.x + n.w * at, y: n.y + n.h };
}

/**
 * 直角折线：a → 中点 → 中点 → b（n8n 那种正交路径，不是曲线）。
 *
 * 折的方向取起点朝向；终点朝向只用来决定末段是否要先横移再接入 ——
 * 比如从左锚点进、右锚点出时，末段必须朝右，否则箭头会从节点背后插进去。
 * 两个方向一致时（同一侧进出）走原路，不额外加拐点。
 */
function elbow(a: Pt, b: Pt, from: Side, to: Side) {
  const horizontal = from === "left" || from === "right";
  const mid = horizontal ? (a.x + b.x) / 2 : (a.y + b.y) / 2;
  const toHorizontal = to === "left" || to === "right";
  // 起点与终点朝向不一致时，末段需要一个额外的正交转折，否则会斜插
  const needsTurn = horizontal !== toHorizontal;
  const pts = horizontal
    ? [
        a,
        { x: mid, y: a.y },
        ...(needsTurn ? [{ x: mid, y: b.y }] : []),
        { x: mid, y: b.y },
        b,
      ]
    : [
        a,
        { x: a.x, y: mid },
        ...(needsTurn ? [{ x: b.x, y: mid }] : []),
        { x: b.x, y: mid },
        b,
      ];
  return dedupe(pts);
}

/**
 * 回传线：a 垂直下到跑道 → 左到 WRAP_X → 上到 b 的高度 → 右入 b。
 *
 * 两个转折点由 a.x / b.y 现算，所以在画布上把 receipt 拖走、把 cron 拖高，
 * 这条线仍然接得上，不会留下悬空的旧折点（原来是三条写死的绝对坐标）。
 * 竖段走 x=4（所有节点都从 x ≥ 13 开始），横段走 y=356（最低节点到 348），
 * 所以整条线不穿过任何框。
 */
function wrapPath(a: Pt, b: Pt, lane: number, wrapX: number) {
  return dedupe([a, { x: a.x, y: lane }, { x: wrapX, y: lane }, { x: wrapX, y: b.y }, b]);
}

function dedupe(pts: Pt[]) {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) out.push(p);
  }
  return out;
}

function toPath(pts: Pt[]) {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
}

type TextAnchor = "start" | "middle" | "end";

function labelPoint(e: WfEdge, a: Pt, b: Pt): { x: number; y: number; anchor: TextAnchor } {
  switch (e.labelPlace) {
    // 两框之间缝的中点，纵向抬到路标带
    case "row":
      return { x: (a.x + b.x) / 2, y: BAND_Y, anchor: "middle" };
    // 右端贴住目标框左侧线，不跨上去
    case "rowEnd":
      return { x: b.x - 6, y: BAND_Y, anchor: "end" };
    // 左端贴着来源框右侧线
    case "rowStart":
      return { x: a.x + 6, y: BAND_Y, anchor: "start" };
    // 竖线标签：贴在线右侧；基线再下移 4，视觉上才在上下两段之间居中
    case "side":
      return { x: a.x + 12, y: (a.y + b.y) / 2 + 4, anchor: "start" };
    // 回传线标签：跑到左下角那条横线的上方
    case "return":
      return { x: (e.wrapX ?? 0) + 16, y: (e.lane ?? 0) - 10, anchor: "start" };
  }
}

/**
 * 箭头三角的 d。
 *
 * 只返回路径，颜色交给 CSS 的 .edge-arrow--*。不能写成 fill="var(--indigo)"：
 * SVG 表现属性不解析 var()，那样只会得到一个黑三角。原来那条回传线整块发黑，
 * 另一半原因就是 path 没有 fill:none，于是被当作闭合多边形填实。
 */
function arrow(tip: Pt, prev: Pt) {
  const dx = tip.x - prev.x;
  const dy = tip.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = tip.x - ux * 6;
  const by = tip.y - uy * 6;
  const p1 = { x: bx - uy * 3, y: by + ux * 3 };
  const p2 = { x: bx + uy * 3, y: by - ux * 3 };
  return `M${tip.x} ${tip.y} L${p1.x} ${p1.y} L${p2.x} ${p2.y} Z`;
}

/* ─────────────────────────── 组件 ─────────────────────────── */

/**
 * fit 的缩放下限。
 *
 * ≤1240px 时画布内宽会掉到 666–942px，按 min(w, h) 硬缩会把 14px 压到 8.3px。
 * 宁可让图横向溢出画布、交给拖动（.flow 本来就是可拖的画布），也不把正文缩成脚注。
 * 0.93 × 14 = 13.02px —— 这是这张图上允许的最小实际字号。
 * 纵向没有这个问题：两个断点里的 .flow 高度都抬到了 0.93 × 380 以上。
 */
const MIN_FIT_Z = 0.93;

/**
 * 屏 3 · 执行链路画布。
 *
 * `active` 用来处理「隐藏时宽度为 0」：画布在别的屏上是 display:none，
 * 此时 fit 出来的 transform 是错的。切回本屏时用 requestAnimationFrame 补一次适配 ——
 * 这一条原设计要求保留，删掉的话从别的屏切回来图会缩成一团或空白。
 */
export function ChainScreen({ data, active }: { data: ConsoleData; active: boolean }) {
  const [nodes, setNodes] = useState<WfNode[]>(() => withLiveValues(INITIAL_NODES, data));
  const [pan, setPan] = useState({ x: 0, y: 0, z: 1 });
  const [panning, setPanning] = useState(false);
  const [hoverId, setHoverId] = useState<NodeId | null>(null);
  const [selected, setSelected] = useState<NodeId | null>(null);
  const [walk, setWalk] = useState(false);
  const [walkFocus, setWalkFocus] = useState<string | null>(null);

  const flowRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: NodeId; dx: number; dy: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const live = withLiveValues(INITIAL_NODES, data);

  const fit = useCallback(() => {
    const el = flowRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    const z = Math.max(MIN_FIT_Z, Math.min(w / VIEW_W, h / VIEW_H));
    // 被下限托住时图比画布大：从左上角起排 —— 居中会把流程两端同时裁掉
    setPan({
      x: w > VIEW_W * z ? (w - VIEW_W * z) / 2 : 0,
      y: h > VIEW_H * z ? (h - VIEW_H * z) / 2 : 0,
      z,
    });
  }, []);

  useLayoutEffect(() => {
    if (!active) return;
    // 隐藏时 clientWidth 为 0，必须等一帧让布局生效
    const raf = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(raf);
  }, [active, fit]);

  // 拖动节点
  const onNodePointerDown = (e: React.PointerEvent, id: NodeId) => {
    // 演示期间由播放器接管画布位置，手动拖动会和运镜抢同一个 transform
    if (walk) return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    const rect = flowRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      id,
      dx: (e.clientX - rect.left - pan.x) / pan.z - n.x,
      dy: (e.clientY - rect.top - pan.y) / pan.z - n.y,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = flowRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (dragRef.current) {
      const { id, dx, dy } = dragRef.current;
      const x = (e.clientX - rect.left - pan.x) / pan.z - dx;
      const y = (e.clientY - rect.top - pan.y) / pan.z - dy;
      setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
      return;
    }
    if (panRef.current) {
      const { px, py, x: ox, y: oy } = panRef.current;
      setPan((p) => ({ ...p, x: ox + (e.clientX - px), y: oy + (e.clientY - py) }));
    }
  };

  const endDrag = () => {
    dragRef.current = null;
    panRef.current = null;
    setPanning(false);
  };

  const onStagePointerDown = (e: React.PointerEvent) => {
    if (walk) return;
    if ((e.target as HTMLElement).closest(".wf-node")) return;
    panRef.current = { x: pan.x, y: pan.y, px: e.clientX, py: e.clientY };
    setPanning(true);
  };

  const zoom = (dir: 1 | -1) => {
    const el = flowRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const cx = w / 2;
    const cy = h / 2;
    const next = Math.max(0.35, Math.min(2.4, pan.z * (dir > 0 ? 1.15 : 1 / 1.15)));
    setPan({
      z: next,
      x: cx - ((cx - pan.x) / pan.z) * next,
      y: cy - ((cy - pan.y) / pan.z) * next,
    });
  };

  const nodeById = (id: NodeId, list: WfNode[]) =>
    id === "@group"
      ? { ...GROUP, id: "@group" as NodeId, tag: "", title: "", meta: "", tier: "judge" as Tier }
      : list.find((n) => n.id === id);

  const dimmed = (id: NodeId) => {
    if (!hoverId) return false;
    if (id === hoverId) return false;
    return !EDGES.some(
      (e) => (e.from === hoverId && e.to === id) || (e.to === hoverId && e.from === id),
    );
  };

  const liveById = (id: NodeId) => live.find((n) => n.id === id) ?? null;

  return (
    <>
      <div className="screen-head">
        <div className="screen-head__main">
          <p className="eyebrow-icons">
            <span className="eyebrow">执行链路</span>
            <span className="screen-head__rule" aria-hidden="true" />
            <span className="mono-meta">{INITIAL_NODES.length} 个节点</span>
          </p>
          <h1 className="screen-title" id="ch-title">
            一条 workflow，每个数字都带出处
          </h1>
          <p className="lede">
            <strong>虚线框 = 该格数据未采集。</strong>点开任一节点看来源。
          </p>
        </div>
        <div className="od-row">
          <button
            className="btn-ghost"
            type="button"
            onClick={() => {
              setWalk(true);
              setSelected(null); // 抽屉会挡住运镜
            }}
          >
            <Icon name="play" size={13} /> 演示
          </button>
          <button className="btn-ghost" type="button" onClick={() => setNodes(live)}>
            <Icon name="reset" size={14} /> 复位
          </button>
        </div>
      </div>

      <section className="panel panel--flush" aria-label="workflow 画布">
        <div className="flow-toolbar">
          <p className="flow-toolbar__fig">FIG. 03 · CRE WORKFLOW</p>
          <div className="flow-toolbar__spacer" />
          <div className="zoombar" role="group" aria-label="画布缩放">
            <button
              className="zoombar__btn zoombar__btn--icon"
              type="button"
              onClick={() => zoom(-1)}
              aria-label="缩小"
            >
              <Icon name="none" size={15} />
            </button>
            <span className="zoombar__readout">{Math.round(pan.z * 100)}%</span>
            <button
              className="zoombar__btn zoombar__btn--icon"
              type="button"
              onClick={() => zoom(1)}
              aria-label="放大"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button className="zoombar__btn zoombar__btn--text" type="button" onClick={fit}>
              适配
            </button>
          </div>
        </div>

        <div
          className="flow"
          ref={flowRef}
          data-panning={panning ? "true" : "false"}
          data-walk={walk ? "true" : "false"}
        >
          <div
            className="flow__stage"
            style={{
              width: VIEW_W,
              height: VIEW_H,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${pan.z})`,
              transformOrigin: "0 0",
            }}
            onPointerDown={onStagePointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            {/* 分组框排在连线之前：它带一层底色，压在连线之上会把扇入的三根线洗淡 */}
            <div
              className="wf-group"
              style={{ left: GROUP.x, top: GROUP.y, width: GROUP.w, height: GROUP.h }}
            >
              <span className="wf-group__label">{GROUP.label}</span>
            </div>

            <svg
              className="flow__edges"
              width={VIEW_W}
              height={VIEW_H}
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              aria-hidden="true"
            >
              {EDGES.map((e) => {
                const f = nodeById(e.from, nodes);
                const t = nodeById(e.to, nodes);
                if (!f || !t) return null;
                const a = anchor(f, e.side, e.fromAt);
                const b = anchor(t, e.toSide, e.toAt);
                const pts =
                  e.lane !== undefined && e.wrapX !== undefined
                    ? wrapPath(a, b, e.lane, e.wrapX)
                    : elbow(a, b, e.side, e.toSide);
                const tip = pts[pts.length - 1];
                const prev = pts[pts.length - 2] ?? pts[0];
                const lp = labelPoint(e, a, b);
                const hot = hoverId !== null && (e.from === hoverId || e.to === hoverId);
                const cool = hoverId !== null && !hot;
                return (
                  <g key={`${e.from}-${e.to}`} opacity={cool ? 0.16 : 1}>
                    {/* fill="none" 必须落在元素上。之前只有类名规则 .edge-line 带 fill:none，
                        组件发的却是 .edge--loop，两边对不上，于是折线拿到浏览器默认的
                        fill:black —— 直段退化不可见，三段折的回传线被当成闭合多边形，
                        填成一整块黑楔子。现在类名补齐，元素上再写一遍作为兜底。 */}
                    <path className={`edge-line edge--${e.kind}`} d={toPath(pts)} fill="none" />
                    <path className={`edge-arrow edge-arrow--${e.kind}`} d={arrow(tip, prev)} />
                    {e.label ? (
                      <text className="edge-label" x={lp.x} y={lp.y} textAnchor={lp.anchor}>
                        {e.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>

            {nodes.map((n) => {
              // 位置取自 nodes（可拖动），文字取自 live（跟随数据刷新）：
              // 数据晚一拍到位时读数会自动变，而用户拖到的位置不会跳回去。
              const info = liveById(n.id) ?? n;
              return (
                <button
                  key={n.id}
                  className="wf-node"
                  type="button"
                  data-tier={n.tier}
                  data-missing={info.missing ? "true" : "false"}
                  data-focus={dimmed(n.id) ? "off" : "on"}
                  data-walk-cur={walkFocus === n.id ? "true" : "false"}
                  aria-pressed={selected === n.id}
                  style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
                  onPointerDown={(e) => onNodePointerDown(e, n.id)}
                  onPointerEnter={() => setHoverId(n.id)}
                  onPointerLeave={() => setHoverId(null)}
                  onClick={() => setSelected(n.id)}
                >
                  <span className="wf-node__tag">{info.tag}</span>
                  <span className="wf-node__title">{info.title}</span>
                  <span className="wf-node__meta">{info.meta}</span>
                </button>
              );
            })}

            {/* 未采集便签：不连进主路径 —— 它们确实不在流程里。
                各自贴在自己解释的那个对象下方（取回计划字节 / 分组框），
                宽 140 与 224 都和分组框的 372 不同，左边缘也错开 21px，
                所以读起来是两条批注，而不是叠在一起的两个框
                （原来便签与分组框同宽、同左边缘，两个虚线矩形读成一个形状）。 */}
            <div className="wf-note" style={{ left: 265, top: 160, width: 140, height: 56 }}>
              <span className="wf-note__k">未采集</span>
              <span className="wf-note__t">CDN 缓存命中</span>
            </div>
            <div className="wf-note" style={{ left: 570, top: 270, width: 224, height: 56 }}>
              <span className="wf-note__k">未采集</span>
              <span className="wf-note__t">模型版本 · agent 原始输出</span>
            </div>
          </div>
        </div>

        <ul className="legend">
          <li className="legend__group">
            <span className="legend__label">NODE</span>
            <span className="legend__item">
              <i className="swatch swatch--node" aria-hidden="true" />
              已采集
            </span>
            <span className="legend__item">
              <i className="swatch swatch--node-dashed" aria-hidden="true" />
              未采集
            </span>
          </li>
          <li className="legend__sep" aria-hidden="true" />
          <li className="legend__group">
            <span className="legend__label">EDGE</span>
            <span className="legend__item">
              <i className="swatch swatch--data" aria-hidden="true" />
              数据传递
            </span>
            <span className="legend__item">
              <i className="swatch swatch--loop" aria-hidden="true" />
              回传
            </span>
          </li>
        </ul>
      </section>
        {walk ? (
          <WalkthroughBar
            data={data}
            flowRef={flowRef}
            view={{ w: VIEW_W, h: VIEW_H }}
            rectOf={(id) => {
              const n = nodes.find((x) => x.id === id);
              return n ? { x: n.x, y: n.y, w: n.w, h: n.h } : null;
            }}
            onPan={(x, y, z) => setPan({ x, y, z })}
            onHighlight={setWalkFocus}
            onClose={() => {
              setWalk(false);
              setWalkFocus(null);
              // 退出后回到适配视图 —— 停在放大状态会让人以为图坏了
              requestAnimationFrame(fit);
            }}
          />
        ) : null}
      {selected ? <NodeDrawer node={liveById(selected)} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

/** 把真实读数写进节点。数据变化时它跟着变，坐标不变。 */
function withLiveValues(base: WfNode[], data: ConsoleData): WfNode[] {
  const vault = data.vault.ok ? data.vault.value : null;
  const rounds = data.debate.ok ? data.debate.view.rounds : [];
  const final = data.debate.ok ? data.debate.view.final?.targetWethBps ?? null : null;
  const mean = data.debate.ok ? data.debate.view.mean : null;
  const exec = data.history.ok
    ? data.history.rows.filter((r) => r.kind === "PlanExecuted").at(-1)
    : undefined;

  const bpsOf = (agent: string) =>
    rounds.find((r) => r.agent === agent)?.targetWethBps ?? null;

  const fmtBps = (v: number | null) =>
    v === null ? "未采集" : `${v.toLocaleString("en-US")} bps`;

  /**
   * 每个节点的 meta 只写**真的读到过**的东西。
   *
   * 有几处特意留「未采集」，因为写上去就是在编：
   *  · cron ——「每 10 分钟」是 PRD 规范值，我们没采到实际触发时刻
   *  · gate —— 前端读不到门禁的判定过程与每项上限值。能从 PlanExecuted 存在
   *           反推出「放行过」，但那是推断，必须标出来，不能写成「1500 bps 放行」
   */
  const meta: Record<string, string> = {
    cron: "未采集",
    read: vault ? `区块 ${vault.blockNumber}` : "未采集",
    http: data.plan.size === null ? "未采集" : `200 · ${data.plan.size} B`,
    hash: data.plan.fileHash ? shortHash(data.plan.fileHash) : "未采集",
    bull: fmtBps(bpsOf("bull")),
    bear: fmtBps(bpsOf("bear")),
    risk: fmtBps(bpsOf("risk")),
    judge:
      final === null
        ? "未采集"
        : `${final.toLocaleString("en-US")} bps${mean !== null ? ` · ${fmtDeviation(final - mean)}` : ""}`,
    // 有执行事件 = 门禁放行过（推断，不是读数）
    gate: exec ? "放行（由执行事件推断）" : "未采集",
    write: exec ? `区块 ${exec.blockNumber}` : "未采集",
    // 这个节点是日志，值是交易哈希；别让它和上面的 keccak（字面哈希）撞读
    receipt: exec ? `区块 ${exec.blockNumber} · ${shortHash(exec.txHash)}` : "未采集",
  };

  return base.map((n) => {
    const value = meta[n.id] ?? n.meta;
    // 虚线 = 这一格没有读数。判据只有一条：meta 就是「未采集」这个字面量。
    return { ...n, meta: value, missing: value === "未采集" };
  });
}

/**
 * 裁决与均值的偏差，取整。
 *
 * 之前直接把 `final - mean` 插进模板串，浮点中间值原样进了 DOM：
 * `1,300 bps · -466.66666666666674`。那是把计算过程摊在读数位置上 ——
 * 这个位置只该有一个能复核的整数。取整后这一行也从 30 字符缩到 16，
 * 不再是那张表里最宽的一行。
 */
function fmtDeviation(dev: number) {
  const rounded = Math.round(dev);
  // 四舍五入到 0 不写符号：+0 是错的，-0 更错
  if (rounded === 0) return "0";
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function shortHash(h: string) {
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

function NodeDrawer({ node, onClose }: { node: WfNode | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!node) return null;

  return (
    <>
      <button className="scrim" type="button" aria-label="关闭详情" onClick={onClose} />
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        ref={ref}
      >
        <div className="drawer__head">
          <p className="drawer__eyebrow">{node.tag}</p>
          <h2 className="drawer__title" id="drawer-title">
            {node.title}
          </h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="drawer__body">
          <dl className="drawer__kv">
            <div>
              <dt>取值</dt>
              <dd>{node.meta}</dd>
            </div>
            <div>
              <dt>来源</dt>
              <dd>{node.meta === "未采集" ? "未采集" : "链上 / 计划文件"}</dd>
            </div>
          </dl>
          <section className="drawer__section">
            <h3 className="drawer__eyebrow">这一处缺什么</h3>
            <p>
              {node.meta === "未采集"
                ? "无值。不显示 0 —— 0 是主张，未采集是另一件事。"
                : "可直接在链上或计划文件复核。"}
            </p>
          </section>
        </div>
      </aside>
    </>
  );
}
