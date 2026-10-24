"use client";

import {
  Play,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Blocks,
  Brain,
  Check,
  Clock,
  Coins,
  Copy,
  Database,
  Droplets,
  FileCheck2,
  FileJson,
  Fingerprint,
  Gauge,
  Hash,
  Info,
  Minus,
  Percent,
  RotateCcw,
  ShieldCheck,
  Upload,
  Wallet,
  X,
} from "lucide-react";

/**
 * 图标语义表。
 *
 * 原则：图标承担「这是什么」，文字只承担图标说不出的部分（数值、来源、限制）。
 * 每个图标只依赖**语义**、不依赖装饰 —— 同一个概念在任何屏用同一个图标：
 *   块号 → Blocks · 哈希 → Hash · 计划文件 → FileJson · 校验 → FileCheck2
 *   NAV → Wallet · 现金 → Coins · WETH → Droplets · 裁决 → Brain
 *   纪律 → ShieldCheck · 标的占用 → Gauge · 来源 → Database
 *
 * 全部 aria-hidden：可访问名称由旁边的文字提供，图标不重复朗读。
 */
export const I = {
  time: Clock,
  block: Blocks,
  hash: Hash,
  file: FileJson,
  verify: FileCheck2,
  fingerprint: Fingerprint,
  check: Check,
  fail: X,
  warn: AlertTriangle,
  info: Info,
  up: ArrowUpRight,
  down: ArrowDownRight,
  copy: Copy,
  upload: Upload,
  reset: RotateCcw,
  play: Play,
  nav: Wallet,
  decision: Brain,
  discipline: ShieldCheck,
  exposure: Gauge,
  cash: Coins,
  weth: Droplets,
  db: Database,
  pct: Percent,
  none: Minus,
};

export type IconName = keyof typeof I;

/** 统一尺寸与描边，保证全站图标粗细一致（1.5 与 16px 正文的字重相称）。 */
export function Icon({
  name,
  size = 16,
  strokeWidth = 1.5,
  className,
  label,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** 只在图标是唯一可见语义时给（例如按钮里只有图标） */
  label?: string;
}) {
  const Comp = I[name];
  return (
    <Comp
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
    />
  );
}

/**
 * 带图标的字段行：图标 + 标签 + 值。
 * 用来替代「标签：值（括号里夹一长串解释）」。
 */
export function Field({
  icon,
  label,
  value,
  tone,
}: {
  icon: IconName;
  label: string;
  value: React.ReactNode;
  tone?: "ok" | "warn" | "err" | "muted";
}) {
  return (
    <span className="ifield" data-tone={tone}>
      <Icon name={icon} size={14} className="ifield__icon" />
      <span className="ifield__label">{label}</span>
      <span className="ifield__value">{value}</span>
    </span>
  );
}

/** 状态标记：图标 + 短语，替代整句说明。 */
export function State({
  kind,
  children,
  title,
}: {
  kind: "ok" | "warn" | "err" | "muted";
  children?: React.ReactNode;
  title?: string;
}) {
  const name: IconName =
    kind === "ok" ? "check" : kind === "err" ? "fail" : kind === "warn" ? "warn" : "none";
  return (
    <span className="istate" data-tone={kind} title={title}>
      <Icon name={name} size={13} strokeWidth={1.75} />
      {children ? <span>{children}</span> : null}
    </span>
  );
}
