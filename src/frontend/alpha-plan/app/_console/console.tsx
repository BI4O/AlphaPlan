"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { SCREENS, Sidebar, Topbar } from "./shell";

/** 五屏 id。从 shell 的只读元组推导，避免两处各写一遍。 */
type ScreenId = (typeof SCREENS)[number]["id"];
import type { ConsoleData } from "./types";
import { BookScreen } from "./screens/book";
import { ChainScreen } from "./screens/chain";
import { DebateScreen } from "./screens/debate";
import { OverviewScreen } from "./screens/overview";
import { VerifyScreen } from "./screens/verify";

/**
 * 控制台外壳。
 *
 * 为什么切换屏用 React state 而不是路由：五屏共享同一份数据快照（同一块号读出来的
 * 金库、同一份计划文件、同一段事件区间）。换成路由的话，切屏会各自再读一次链，
 * 五个屏的数字就会来自不同的块 —— 那正好毁了「每个数字都能对上」这件事。
 *
 * 屏在 DOM 里一直存在，只切 hidden。理由和上面一样，另外还为了画布：
 * 隐藏时宽度为 0，切回来必须重新适配一次（见 ChainScreen 里的 requestAnimationFrame）。
 */
export function Console({ data }: { data: ConsoleData }) {
  const [screen, setScreen] = useState<ScreenId>("overview");
  const [navOpen, setNavOpen] = useState(false);

  /**
   * 屏与 URL hash 双向同步。
   *
   * 同页 tab 没法分享某一屏的链接 —— demo 时要连点三下才能到「金库与流水」，
   * 也没法把某一屏直接发给别人。hash 同步用二十行解决这个问题，
   * 并且让 reviewer 能凭 URL 直接进屏（#book）。
   *
   * 为什么用 hash 而不是路由：五屏共享同一份数据快照（同一块号读出来的金库、
   * 同一份计划文件）。换成路由的话，切屏会各自再读一次链，五个屏的数字就会
   * 来自不同的块 —— 那正好毁掉「每个数字都能对上」这件事。
   */
  const mainRef = useRef<HTMLDivElement>(null);

  const goTo = useCallback((id: ScreenId) => {
    setScreen(id);
    setNavOpen(false);
    // 切屏后回到顶部，否则长屏（金库）滚到一半切到短屏（自验）会看到空白
    if (mainRef.current) mainRef.current.scrollTop = 0;
    // replaceState 而不是 pushState：切屏不该在浏览器历史里堆一大堆条目，
    // 否则「后退」要按五次才离开页面。
    if (typeof window !== "undefined") {
      const next = id === "overview" ? window.location.pathname : `#${id}`;
      window.history.replaceState(null, "", next);
    }
  }, []);

  // 首屏读一次 hash（直接访问 /#book 要能落在金库屏）
  useEffect(() => {
    const fromHash = () => {
      const raw = window.location.hash.replace(/^#/, "");
      const found = SCREENS.find((s) => s.id === raw);
      if (found) setScreen(found.id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  // 窄屏下侧栏是抽屉式：Esc 关闭，且焦点回到菜单键（读屏用户依赖这个）
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const title = SCREENS.find((s) => s.id === screen)?.title ?? "总览";

  return (
    <div className="app">
      <Sidebar
        active={screen}
        planLabel={data.plan.planId}
        planSize={data.plan.size}
        chainNodeCount={data.chainNodeCount}
        interactive
        navOpen={navOpen}
        onNavigate={(id) => goTo(id as ScreenId)}
      />

      <div className="main">
        <Topbar
          title={title}
          withWallet
          navOpen={navOpen}
          onToggleNav={() => setNavOpen((v) => !v)}
          chip={data.vault.ok ? `区块 ${data.vault.value.blockNumber}` : undefined}
          status={
            data.vault.ok
              ? { tone: "ok", label: "链上读取成功" }
              : { tone: "warn", label: "链上读取失败" }
          }
        />

        <main className="content" id="content" ref={mainRef}>
          <section
            className="screen"
            id="screen-overview"
            aria-labelledby="ov-title"
            hidden={screen !== "overview"}
          >
            <OverviewScreen data={data} onGoTo={goTo} />
          </section>

          <section
            className="screen"
            id="screen-debate"
            aria-labelledby="db-title"
            hidden={screen !== "debate"}
          >
            <DebateScreen data={data} />
          </section>

          <section
            className="screen"
            id="screen-chain"
            aria-labelledby="ch-title"
            hidden={screen !== "chain"}
          >
            <ChainScreen data={data} active={screen === "chain"} />
          </section>

          <section
            className="screen"
            id="screen-verify"
            aria-labelledby="vf-title"
            hidden={screen !== "verify"}
          >
            <VerifyScreen data={data} />
          </section>

          <section
            className="screen"
            id="screen-book"
            aria-labelledby="bk-title"
            hidden={screen !== "book"}
          >
            <BookScreen data={data} />
          </section>
        </main>
      </div>

      {navOpen ? (
        <button
          className="scrim"
          type="button"
          aria-label="关闭导航"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
    </div>
  );
}
