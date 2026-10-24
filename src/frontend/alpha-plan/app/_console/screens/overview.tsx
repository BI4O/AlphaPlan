import { fixed, shortHex } from "@/lib/format";

import { DemoPanel } from "../demo-panel";
import { Icon } from "../icons";
import type { ConsoleData } from "../types";

/**
 * 屏 1 · 总览 —— 只回答「现在怎么样」。
 *
 * 这里没有一条编造的空气：每个数字要么来自链上同一块号，要么来自计划文件的原始字节，
 * 要么就是「—」加原因。时间轴不带时间戳，因为这一轮的实际执行时刻我们没有采集到
 * （只有链上块时间，那不等于哪一步在几点跑完）—— 缺就说缺。
 */
export function OverviewScreen({
  data,
  onGoTo,
}: {
  data: ConsoleData;
  onGoTo: (id: "verify" | "chain" | "book") => void;
}) {
  const vault = data.vault.ok ? data.vault.value : null;
  const verdict = data.debate.ok ? data.debate.view.final : null;
  const mean = data.debate.ok ? data.debate.view.mean : null;
  const delta = data.debate.ok ? data.debate.view.delta : null;
  const strategy = data.history.ok ? data.history.rows.filter((r) => r.category === "strategy") : [];

  const navUsdc = vault ? vault.totalAssets : null;

  return (
    <>
      <div className="screen-head">
        <div className="screen-head__main">
          <p className="eyebrow-icons">
            <span className="eyebrow">总览</span>
            <span className="screen-head__rule" aria-hidden="true" />
            <Icon name="file" size={14} className="eyebrow-icons__icon" />
            <span className="mono-meta">{data.plan.planId ?? "—"}</span>
          </p>
          <h1 className="screen-title" id="ov-title">
            这一轮做了什么，账对不对
          </h1>
          <p className="lede">
            {verdict?.targetWethBps != null ? (
              <>
                三个 agent 各给一个目标仓位，judge 裁决{" "}
                <strong>{verdict.targetWethBps} bps</strong>。
              </>
            ) : (
              <>本轮裁决未采集到。</>
            )}
          </p>
        </div>
        <div>
          <button
            className="btn-primary"
            type="button"
            onClick={() => onGoTo("verify")}
          >
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
            核对这一轮
          </button>
        </div>
      </div>

      <div className="kpis" role="group" aria-label="关键数字">
        <div className="kpi kpi--lead">
          <p className="kpi__label">
            <Icon name="nav" size={13} /> NAV
          </p>
          <p className="kpi__value od-nowrap">
            {navUsdc === null ? "—" : fixed(navUsdc, 2)}
            <span className="unit">{vault?.assetSymbol ?? "USDC"}</span>
          </p>
          <p className="kpi__sub">
            {vault
              ? `链上读数 · 区块 ${vault.blockNumber}`
              : (data.vault.ok ? "—" : data.vault.reason)}
          </p>
        </div>

        <div className="kpi">
          <p className="kpi__label">
            <Icon name="decision" size={13} /> 本轮裁决
          </p>
          <p className="kpi__value od-nowrap">
            {verdict?.targetWethBps == null ? "—" : verdict.targetWethBps}
            <span className="unit">bps</span>
          </p>
          <p className="kpi__sub">
            {mean === null || delta === null
              ? "算术均值未采集"
              : `较算术均值 ${delta > 0 ? "+" : ""}${delta} bps`}
          </p>
        </div>

        <div className="kpi">
          <p className="kpi__label">
            <Icon name="verify" size={13} /> 哈希自验
          </p>
          {/*
            这一格只回答「链上执行的那份，本地有没有、对不对得上」。
            绝不能把链上的哈希配上本地最新文件的大小 ——
            那是两个不同文件的字段，混在一起显示成「不一致」，
            看起来像数据被篡改，实际只是本地有一份还没上链的新计划。
          */}
          <p className="kpi__value od-nowrap">
            {data.planOnchain.hash === null
              ? "—"
              : data.planOnchain.matchesOnchain
                ? "一致"
                : "本地缺失"}
          </p>
          <p className="kpi__sub">
            {data.planOnchain.hash ? (
              <>
                <span className="num">{shortHex(data.planOnchain.hash, 8, 4)}</span>
                {" · "}
                {data.planOnchain.size === null
                  ? "无本地文件"
                  : `${data.planOnchain.size} B`}
                {data.planLocal.present && !data.planLocal.matchesOnchain ? (
                  <>
                    {" · "}
                    <span className="warn">
                      另有 {data.planLocal.planId?.slice(11, 19)} 未上链
                    </span>
                  </>
                ) : null}
              </>
            ) : (
              "链上哈希未采集"
            )}
          </p>
        </div>

        <div className="kpi">
          <p className="kpi__label">
            <Icon name="discipline" size={13} /> 纪律越界
          </p>
          <p className="kpi__value od-nowrap">
            {data.breaches.length}
            <span className="unit">项</span>
          </p>
          <p className="kpi__sub">
            {data.breaches.length === 0 ? (
              <span className="istate" data-tone="ok">
                <Icon name="check" size={13} strokeWidth={1.75} /> 全部在限内
              </span>
            ) : (
              <>
                <span className="warn">{data.breaches[0].value}</span>{" "}
                {data.breaches[0].limit}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="cols-12">
        <section className="panel span-8" aria-labelledby="tl-title">
          <div className="panel__head">
            <h2 className="panel-title" id="tl-title">
              本轮环节
            </h2>
            <button
              className="link-btn"
              type="button"
              onClick={() => onGoTo("chain")}
            >
              查看链路细节
            </button>
          </div>
          <div className="timeline">
            {data.timeline.map((step) => (
              <div className="tl" key={step.no}>
                <span className="tl__no">{step.no}</span>
                <div className="tl__body">
                  <p className="tl__name">{step.name}</p>
                  <p className="tl__meta">{step.detail}</p>
                </div>
                <div className="tl__right">
                  {step.time ? <span className="tl__time">{step.time}</span> : null}
                  <span className="tl__state" data-tone={step.state}>
                    {step.stateLabel}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel panel--linen span-4" aria-labelledby="sys-title">
          <div className="panel__head">
            <h2 className="panel-title" id="sys-title">
              系统状态
            </h2>
          </div>
          <dl className="statlist">
            <div>
              <dt>调度</dt>
              <dd>每 10 分钟（PRD 规范值）</dd>
            </div>
            <div>
              <dt>数据源</dt>
              <dd>{vault ? "本地 RPC · viem" : "读取失败"}</dd>
            </div>
            <div>
              <dt>签名方</dt>
              <dd>本地 CLI 私钥</dd>
            </div>
            <div>
              <dt>计划文件</dt>
              <dd>
                {data.plan.size === null ? "未找到" : `${data.plan.size} B · keccak256`}
              </dd>
            </div>
            <div>
              <dt>块号</dt>
              <dd>{vault ? vault.blockNumber.toString() : "—"}</dd>
            </div>
            <div>
              <dt>仓位上界</dt>
              <dd>{vault ? `${vault.currentWethBps} bps 当前` : "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="panel span-12" aria-labelledby="recent-title">
          <div className="panel__head">
            <h2 className="panel-title" id="recent-title">
              最近策略交易
            </h2>
            <button className="link-btn" type="button" onClick={() => onGoTo("book")}>
              全部流水
            </button>
          </div>
          {strategy.length === 0 ? (
            <div className="empty">
              <Icon name="none" size={22} className="empty__icon" />
              <p className="empty__title">本期 0 笔</p>
              <p className="empty__msg">金库只在计划通过门禁时才会动。</p>
            </div>
          ) : (
            <table className="ledger">
              <caption>
                最近 {Math.min(strategy.length, 5)} 笔策略交易 · 数字均来自链上事件
              </caption>
              <thead>
                <tr>
                  <th scope="col">块</th>
                  <th scope="col">动作</th>
                  <th scope="col" className="r">
                    金额
                  </th>
                  <th scope="col" className="r">
                    仓位
                  </th>
                  <th scope="col">计划哈希</th>
                  <th scope="col">交易</th>
                </tr>
              </thead>
              <tbody>
                {strategy.slice(-5).reverse().map((row) => (
                  <tr key={`${row.txHash}-${row.logIndex}`}>
                    <td className="num">{row.blockNumber.toString()}</td>
                    <td>
                      {/* 三态：PlanRecorded = 计划记录但未交易，不能读成"卖出" */}
                      {row.kind === "PlanRecorded"
                        ? "未交易"
                        : row.usdcIn
                          ? "买入 WETH"
                          : "卖出 WETH"}
                    </td>
                    <td className="r num">
                      {row.kind === "PlanRecorded"
                        ? "容差内"
                        : row.usdcIn !== null
                          ? `${fixed(row.usdcIn, 6)} USDC`
                          : row.usdcOut !== null
                            ? `${fixed(row.usdcOut, 6)} USDC`
                            : "—"}
                    </td>
                    <td className="r num">
                      {row.actualWethBps === null ? "—" : `${row.actualWethBps} bps`}
                    </td>
                    <td className="num">{row.planHash ? shortHex(row.planHash, 8, 4) : "—"}</td>
                    <td className="num">{shortHex(row.txHash, 6, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/*
        演示操作放在总览屏最下面、**在 cols-12 网格之外**：
        网格是 span-8 + span-4 的两栏，塞进去会被挤成一条窄栏。
        它回答的是「怎么走到这个状态」，与上面的「现在是什么状态」上下承接。
      */}
      <DemoPanel />
    </>
  );
}
