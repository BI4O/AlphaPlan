"use client";

import { ConnectButton } from "../_wallet/connect-button";

/**
 * 控制台外壳（侧栏 + 顶栏 + 内容槽）。
 *
 * 为什么单独抽出来：整页数据读取要等 RPC 与 fs，那段时间不该是一个没有导航的空壳。
 * 骨架和真实内容共用这个外壳，所以首屏永远有侧栏五项、顶栏标题、钱包入口 ——
 * 只有中间的内容区在等数据。
 *
 * 设计规范禁用了骨架屏呼吸灯，所以加载态是静默的静态占位。
 */

const SCREENS = [
  { id: "overview", title: "总览" },
  { id: "debate", title: "辩论与裁决" },
  { id: "chain", title: "执行链路" },
  { id: "verify", title: "哈希自验" },
  { id: "book", title: "金库与流水" },
] as const;

export function NavIcon({ name }: { name: string }) {
  const common = {
    className: "od-icon",
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    "aria-hidden": true as const,
  };
  if (name === "grid") {
    return (
      <svg {...common}>
        <rect x="2" y="2" width="5" height="5" rx="1" />
        <rect x="9" y="2" width="5" height="5" rx="1" />
        <rect x="2" y="9" width="5" height="5" rx="1" />
        <rect x="9" y="9" width="5" height="5" rx="1" />
      </svg>
    );
  }
  if (name === "bars") {
    return (
      <svg {...common}>
        <path d="M4 3v10M8 3v6M12 3v8" />
      </svg>
    );
  }
  if (name === "flow") {
    return (
      <svg {...common}>
        <circle cx="3.5" cy="8" r="1.8" />
        <circle cx="12.5" cy="8" r="1.8" />
        <path d="M5.3 8h5.4" />
        <circle cx="8" cy="3.2" r="1.4" />
        <path d="M4.8 6.6L7 4.2M11.2 6.6L9 4.2" />
      </svg>
    );
  }
  if (name === "check") {
    return (
      <svg {...common}>
        <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
        <path d="M5 8.2l2 2 4-4.4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M3 3.5h10M3 7h10M3 10.5h10M3 14h6" />
    </svg>
  );
}

export const SCREEN_ICONS: Record<string, string> = {
  overview: "grid",
  debate: "bars",
  chain: "flow",
  verify: "check",
  book: "ledger",
};

/** 侧栏：loading 与 loaded 共用，保证首屏有导航。 */
export function Sidebar({
  active,
  planLabel,
  planSize,
  chainNodeCount,
  interactive,
  navOpen = false,
  onNavigate,
}: {
  active: string;
  planLabel: string | null;
  planSize: number | null;
  chainNodeCount: number | null;
  interactive: boolean;
  navOpen?: boolean;
  onNavigate?: (id: string) => void;
}) {
  return (
    <aside
      className="sidebar"
      id="sidebar"
      aria-label="主导航"
      data-open={navOpen ? "true" : "false"}
    >
      <div className="sidebar__top">
        <div className="brand">
          <span className="brand__word">AlphaPlan</span>
          <span className="brand__sub">可审计的 AI 基金经理</span>
        </div>
      </div>

      <nav className="nav" aria-label="屏幕">
        <p className="nav__label">工作区</p>
        {SCREENS.map((s) => (
          <button
            key={s.id}
            className="nav__item"
            type="button"
            data-screen={s.id}
            disabled={!interactive}
            onClick={() => onNavigate?.(s.id)}
            aria-current={interactive && active === s.id ? "page" : undefined}
          >
            <NavIcon name={SCREEN_ICONS[s.id]} />
            <span>{s.title}</span>
            {s.id === "chain" && chainNodeCount !== null ? (
              <span className="nav__badge">{chainNodeCount}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="sidebar__foot">
        <div className="fidelity">
          <p className="fidelity__line">
            <span className="fidelity__dot" aria-hidden="true" />
            <span className="fidelity__text">L2 · 真实链路 · 真交易</span>
          </p>
          <p className="fidelity__note">签名方：本地 CLI（非 DON）</p>
        </div>
        <p className="sidebar__plan">
          {planLabel ?? "—"}
          <br />
          {planSize === null ? "—" : `${planSize} B`}
        </p>
        <p className="sidebar__sample">链上读数 · 非回放</p>
      </div>
    </aside>
  );
}

/**
 * 顶栏。
 *
 * `withWallet` 默认 false：骨架态不渲染 ConnectButton。
 * 原因不是保守 —— 是硬约束：useAppKit 系列 hook 要求 createAppKit 已经跑过，
 * 而 AppKit 只能在浏览器里初始化（服务端预渲染没有网络上下文）。
 * 骨架是构建期就生成的纯静态 HTML，里面放 hook 会直接让构建失败：
 *   "Please call createAppKit before using useAppKit hook"
 */
export function Topbar({
  title,
  chip,
  withWallet = false,
  navOpen = false,
  onToggleNav,
  status,
}: {
  title: string;
  chip?: string;
  withWallet?: boolean;
  navOpen?: boolean;
  onToggleNav?: () => void;
  status?: { tone: "ok" | "warn"; label: string };
}) {
  return (
    <header className="topbar">
      <button
        className="topbar__menu"
        type="button"
        aria-expanded={navOpen}
        aria-controls="sidebar"
        aria-label="打开导航"
        onClick={onToggleNav}
      >
        <svg
          className="od-icon"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
          style={{ "--od-icon-size": "18px" } as React.CSSProperties}
        >
          <path d="M2 4.5h12M2 8h12M2 11.5h12" />
        </svg>
      </button>
      <p className="topbar__title">{title}</p>
      <div className="topbar__right">
        {withWallet ? <ConnectButton /> : null}
        {chip ? <span className="chip od-nowrap">{chip}</span> : null}
        {status ? (
          <span className="pill" data-tone={status.tone}>
            {status.tone === "ok" ? (
              <svg
                className="od-icon"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                aria-hidden="true"
              >
                <path d="M3 8.5l3.2 3.2L13 4.5" />
              </svg>
            ) : null}
            <span>{status.label}</span>
          </span>
        ) : null}
      </div>
    </header>
  );
}

export { SCREENS };
