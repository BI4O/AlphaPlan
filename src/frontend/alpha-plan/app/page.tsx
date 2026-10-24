import { Suspense } from "react";
import { io } from "next/cache";

import "./_console/console.css";
import "./_wallet/wallet.css";
import { Console } from "./_console/console";
import { loadConsoleData } from "./_console/data";
import { Sidebar, Topbar } from "./_console/shell";

async function ConsoleShell() {
  // next.config 开了 cacheComponents：未缓存读取（RPC / fs）必须显式 await io()
  await io();
  const data = await loadConsoleData();
  return <Console data={data} />;
}

/**
 * 加载态。
 *
 * 关键点：**外壳（侧栏五项 + 顶栏 + 钱包入口）在骨架里就有**。
 * 早先这里只有 brand + 一行「正在读取…」，于是数据没到的那几百毫秒里，
 * 首屏是一个没有导航的空壳 —— 评委第一次打开会以为页面坏了。
 *
 * 侧栏按钮在加载态 disabled：此时屏内容还不存在，点了只会得到空白。
 */
function ShellFallback() {
  return (
    <div className="app">
      <Sidebar
        active="overview"
        planLabel={null}
        planSize={null}
        chainNodeCount={null}
        interactive={false}
      />
      <div className="main">
        <Topbar title="总览" />
        <main className="content">
          <div className="screen-head">
            <div className="screen-head__main">
              <p className="eyebrow-icons">
                <span className="eyebrow">总览</span>
                <span className="screen-head__rule" aria-hidden="true" />
                <span className="mono-meta">读取中</span>
              </p>
              <h1 className="screen-title">正在读取链上状态</h1>
            </div>
          </div>
          <div className="kpis" aria-hidden="true">
            {["NAV", "本轮裁决", "哈希自验", "纪律越界"].map((label) => (
              <div className={label === "NAV" ? "kpi kpi--lead" : "kpi"} key={label}>
                <p className="kpi__label">{label}</p>
                <p className="kpi__value od-nowrap">—</p>
                <p className="kpi__sub">读取中</p>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * 单页控制台。
 *
 * 五屏共用一份数据快照 —— 块号、计划文件、事件区间都来自同一次读取。
 * 所以整页只有一个 Suspense 边界：如果按屏拆边界，切屏时会各自再读一次链，
 * 五个屏的数字就会来自不同的块，那正好毁掉「每个数字都能对上」。
 */
export default function Page() {
  return (
    <Suspense fallback={<ShellFallback />}>
      <ConsoleShell />
    </Suspense>
  );
}
