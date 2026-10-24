"use client";

import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { buildWalkthrough, missingReason } from "./walkthrough-steps";
import type { ConsoleData } from "./types";

/**
 * 执行链路的演示播放器。
 *
 * 形态：画布自动运镜到当前节点 + 底部一条字幕。
 *
 * 三个刻意的取舍：
 *
 * 1. **每一步可以无限期停住**。自动播放有 6 秒的节奏，但一按暂停就
 *    永远停在当前步 —— demo 时讲到一半被打断是常事，回来还能接着讲。
 * 2. **运镜不用 CSS transition，用 rAF 插值**。transform 上有 transition 时，
 *    用户手动拖动会和动画抢同一个属性，拖动会「粘手」。这里只在演示播放期间
 *    接管 pan，播放一停，手动操作立刻恢复。
 * 3. **首尾步骤不循环**。第 11 步之后退出演示而不是回到第 1 步 ——
 *    循环会让「讲完了」这件事消失，讲者不知道什么时候该停。
 */

/** 每步停留时长（毫秒）。够读完一句中文，又不至于让人等。 */
const STEP_MS = 6000;

/** 运镜动画时长。比 STEP_MS 短得多，让观众清楚看到「移动」和「停留」是两件事。 */
const FLY_MS = 620;

/** 演示时把目标节点放大到这个倍数 —— 太小看不清，太大失去上下文。 */
const FOCUS_ZOOM = 1.28;

type Props = {
  data: ConsoleData;
  /** 画布容器，用来算视口中心与当前尺寸 */
  flowRef: React.RefObject<HTMLDivElement | null>;
  /** 画布逻辑尺寸，与 chain.tsx 的 VIEW_W / VIEW_H 同源 */
  view: { w: number; h: number };
  /** 目标节点在**逻辑坐标**里的矩形 */
  rectOf: (nodeId: string) => { x: number; y: number; w: number; h: number } | null;
  /** 由 chain.tsx 注入：设置画布 pan/zoom */
  onPan: (x: number, y: number, z: number) => void;
  onClose: () => void;
  /** 当前高亮节点，null = 无 */
  onHighlight: (nodeId: string | null) => void;
};

export function WalkthroughBar({
  data,
  flowRef,
  view,
  rectOf,
  onPan,
  onClose,
  onHighlight,
}: Props) {
  const [script] = useState(() => buildWalkthrough(data));
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const rafRef = useRef<number | null>(null);

  const total = script.steps.length;
  const step = script.steps[index];

  /**
   * 把某个节点移到视口中心并放大。
   *
   * 公式与 chain.tsx 的 zoom() 一致：
   *   屏幕点 = pan + 逻辑点 * z
   * 要让逻辑点 (cx, cy) 落在视口中心 (w/2, h/2)：
   *   pan = 视口中心 - 逻辑点 * z
   *
   * 用 rAF 在起止状态之间插值，而不是给 .flow__stage 加 transition ——
   * 那个元素同时承载用户的拖动，transition 会让拖动有一层追尾延迟。
   */
  const flyTo = useCallback(
    (nodeId: string) => {
      const el = flowRef.current;
      const rect = rectOf(nodeId);
      if (!el || !rect) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;

      const z = FOCUS_ZOOM;
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;

      /*
        边界处理。这里的夹取范围是「留一点余量」而不是「图完全不脱出视口」。

        为什么不能用 w - scaledW 作下界：VIEW_W = 1134，放大 1.28 后是 1452px，
        而画布只有 ~1100px。下界于是变成 -352 —— 也就是说整张图必须有一半以上
        留在屏幕里，前 4 个节点（x 从 13 到 415）算出来的中心 pan 全都超界，
        被夹成 0。结果第 1 步到第 4 步 transform 一模一样，观众看不出运镜在动。

        改成允许图移出到只留 PEEK 那么多，就能把任意节点真正带到视口中心；
        同时图不会整个飞走（留 25% 宽度可辨上下文）。
      */
      const PEEK = 0.25;
      let tx = w / 2 - cx * z;
      let ty = h / 2 - cy * z;
      const scaledW = view.w * z;
      const scaledH = view.h * z;
      if (scaledW > w) {
        tx = Math.min(w * PEEK, Math.max(w * (1 - PEEK) - scaledW, tx));
      }
      if (scaledH > h) {
        ty = Math.min(h * PEEK, Math.max(h * (1 - PEEK) - scaledH, ty));
      }

      // 起止状态在动画开始时快照一次 —— 动画中途用户可能还没拖（演示期间禁用拖动）
      const stage = el.querySelector<HTMLElement>(".flow__stage");
      const m = stage ? /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(
        stage.style.transform,
      ) : null;
      const from = m
        ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) }
        : { x: 0, y: 0, z: 1 };

      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / FLY_MS);
        // easeOutCubic：起步快、收尾稳，读数在最后 100ms 不再漂
        const e = 1 - Math.pow(1 - p, 3);
        onPan(
          from.x + (tx - from.x) * e,
          from.y + (ty - from.y) * e,
          from.z + (z - from.z) * e,
        );
        if (p < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          rafRef.current = null;
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [flowRef, onPan, rectOf, view.h, view.w],
  );

  // 换步：运镜 + 高亮
  useEffect(() => {
    const s = script.steps[index];
    if (!s) return;
    onHighlight(s.nodeId);
    flyTo(s.nodeId);
  }, [index, script.steps, flyTo, onHighlight]);

  // 自动播放
  useEffect(() => {
    if (!playing) return;
    if (index >= total - 1) return; // 最后一步停住，不循环
    const t = setTimeout(() => setIndex((i) => Math.min(total - 1, i + 1)), STEP_MS);
    return () => clearTimeout(t);
  }, [playing, index, total]);

  // 键盘：左右换步、空格播放/暂停、Esc 退出
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 输入框里不劫持键盘（虽然本屏没有输入框，但保持这个习惯）
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setIndex((i) => Math.min(total - 1, i + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying((v) => !v);
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, total]);

  // 退出时清掉动画与高亮
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      onHighlight(null);
    };
  }, [onHighlight]);

  if (!step) return null;

  const reason = step.hasValue ? null : missingReason(step.nodeId);
  const isLast = index === total - 1;

  return (
    <div className="walkbar" role="region" aria-label="演示字幕">
      <div className="walkbar__inner">
        <div className="walkbar__prog" aria-hidden="true">
          {script.steps.map((s, i) => (
            <span
              key={s.nodeId}
              className="walkbar__pip"
              data-on={i <= index ? "true" : "false"}
              data-cur={i === index ? "true" : "false"}
            />
          ))}
        </div>

        <div className="walkbar__body">
          <p className="walkbar__count">
            {String(index + 1).padStart(2, "0")} / {total}
            <span className="walkbar__phase">{phaseLabel(step.nodeId)}</span>
          </p>
          <h3 className="walkbar__title">{step.title}</h3>
          <p className="walkbar__text">{step.body}</p>
          {reason ? <p className="walkbar__why">{reason}</p> : null}
        </div>

        <div className="walkbar__controls">
          <button
            className="walkbar__btn"
            type="button"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            aria-label="上一步"
          >
            <ChevronLeft size={16} strokeWidth={1.7} />
          </button>
          <button
            className="walkbar__btn walkbar__btn--play"
            type="button"
            onClick={() => setPlaying((v) => !v)}
            aria-label={playing ? "暂停" : "播放"}
            disabled={isLast && !playing}
          >
            {playing ? (
              <Pause size={15} strokeWidth={1.7} />
            ) : (
              <Play size={15} strokeWidth={1.7} />
            )}
          </button>
          <button
            className="walkbar__btn"
            type="button"
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
            disabled={isLast}
            aria-label="下一步"
          >
            <ChevronRight size={16} strokeWidth={1.7} />
          </button>
          <span className="walkbar__divider" aria-hidden="true" />
          <button
            className="walkbar__btn walkbar__btn--exit"
            type="button"
            onClick={onClose}
            aria-label="退出演示"
          >
            <X size={15} strokeWidth={1.7} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 阶段标签 —— 与画布上节点分组的视觉分段一致，让观众知道现在讲到哪一段。 */
function phaseLabel(nodeId: string): string {
  switch (nodeId) {
    case "cron":
    case "read":
    case "http":
    case "hash":
      return "采集";
    case "bull":
    case "bear":
    case "risk":
    case "judge":
      return "辩论";
    default:
      return "提交";
  }
}
