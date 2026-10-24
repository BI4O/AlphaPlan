
import { fixed, percentOf, shortHex } from "@/lib/format";
import { termTitle } from "@/lib/terms";

import { FundActions } from "../../_wallet/fund-actions";
import { RefreshOnDone } from "../../_wallet/refresh-on-done";
import { Icon } from "../icons";
import type { ConsoleData } from "../types";

/**
 * 屏 5 · 金库与流水。
 *
 * 对账第一层是硬判据（E6c-1）：余额差分必须精确闭合，不用价格。
 * 两条流分开列，因为「策略交易」与「流动性调整」是两类事 —— 混在一起就
 * 无法回答「这次持仓变化是计划内的吗」。筛到 0 行时给解释性空态，不留空白表。
 */
export function BookScreen({ data }: { data: ConsoleData }) {
  const vault = data.vault.ok ? data.vault.value : null;
  const history = data.history.ok ? data.history : null;
  const strategy = history?.rows.filter((r) => r.category === "strategy") ?? [];
  const liquidity = history?.rows.filter((r) => r.category === "liquidity") ?? [];

  const cashBps =
    vault && vault.totalAssets > 0 ? (vault.cashAsset / vault.totalAssets) * 100 : null;

  return (
    <>
      <div className="screen-head">
        <div className="screen-head__main">
          <p className="eyebrow-icons">
            <span className="eyebrow">金库与流水</span>
            <span className="screen-head__rule" aria-hidden="true" />
            <Icon name="block" size={14} className="eyebrow-icons__icon" />
            <span className="mono-meta">
              {history ? `${history.fromBlock} → ${history.toBlock}` : "—"}
            </span>
          </p>
          <h1 className="screen-title" id="bk-title">
            一本账，两条流，一个必须为零的数
          </h1>
          <p className="lede">两条流的合计必须解释掉所有持仓变化。</p>
        </div>
      </div>

      <dl className="vault">
        <div className="vault__cell vault__cell--lead">
          <dt className="vault__label" title={termTitle("nav")}>
            <Icon name="nav" size={13} /> NAV · 基金总值
          </dt>
          <dd>
            <span className="vault__val od-nowrap">
              {vault ? fixed(vault.totalAssets, 2) : "—"}
              <span className="unit">{vault?.assetSymbol ?? "USDC"}</span>
            </span>
            <span className="vault__sub">
              {vault ? `链上读数 · 区块 ${vault.blockNumber}` : data.vault.ok ? "—" : data.vault.reason}
            </span>
          </dd>
        </div>
        <div className="vault__cell">
          <dt className="vault__label">
            <Icon name="pct" size={13} /> 份额价格
          </dt>
          <dd>
            <span className="vault__val od-nowrap">
              {vault ? fixed(vault.sharePrice, 4) : "—"}
              <span className="unit">USDC</span>
            </span>
            <span className="vault__sub">convertToAssets</span>
          </dd>
        </div>
        <div className="vault__cell">
          <dt className="vault__label">
            <Icon name="cash" size={13} /> 现金
          </dt>
          <dd>
            <span className="vault__val od-nowrap">
              {cashBps === null ? "—" : fixed(cashBps, 1)}
              <span className="unit">%</span>
            </span>
            <span className="vault__sub">
              {vault ? `${fixed(vault.cashAsset, 2)} ${vault.assetSymbol}` : "—"}
            </span>
          </dd>
        </div>
        <div className="vault__cell">
          <dt className="vault__label">
            <Icon name="weth" size={13} /> WETH
          </dt>
          <dd>
            <span className="vault__val od-nowrap">
              {vault ? fixed(vault.currentWethBps / 100, 1) : "—"}
              <span className="unit">%</span>
            </span>
            <span className="vault__sub">
              {vault ? `${fixed(vault.wethAmount, 6)} WETH` : "—"}
            </span>
          </dd>
        </div>
        <div className="vault__cell">
          <dt className="vault__label">
            <Icon name="decision" size={13} /> 总份额
          </dt>
          <dd>
            <span className="vault__val od-nowrap">
              {/* chain.ts 已按 ERC20 decimals 归一（18 位），这里不能再除一次 1e6 */}
              {vault ? fixed(vault.totalSupply, 2) : "—"}
            </span>
            <span className="vault__sub">按 decimals 归一</span>
          </dd>
        </div>
      </dl>

      {/*
        申赎面板。放在数字带下面、流水上面：先看你有什么（五格），
        再做动作（申赎），最后看结果（流水）。
        提交成功后由 onDone 触发 router.refresh()，让五格与流水读到新块号。
      */}
      {vault ? (
        <section className="panel" aria-labelledby="trade-title">
          <div className="panel__head">
            <h2 className="panel-title" id="trade-title">
              申购与赎回
            </h2>
            <span className="mono-meta">签名方是你自己的钱包</span>
          </div>
          <RefreshOnDone>
            {(refresh) => (
          <FundActions
            vault={vault.vault}
            usdc={vault.asset}
            decimals={vault.decimals}
            shareDecimals={vault.shareDecimals}
            assetSymbol={vault.assetSymbol}
            shareSymbol={vault.shareSymbol}
            onDone={refresh}
          />
            )}
          </RefreshOnDone>
        </section>
      ) : null}

      <div className="cols-12">
        <section className="panel span-8" aria-labelledby="str-title">
          <div className="panel__head">
            <h2 className="panel-title" id="str-title">
              策略交易
            </h2>
            <span className="pill">{strategy.length} 笔 · 计划文件触发</span>
          </div>
          {strategy.length === 0 ? (
            <div className="empty">
              <p className="empty__title">这一期内没有策略交易</p>
              <p className="empty__msg">
                部署以来还没有 PlanExecuted 事件。金库只在计划通过门禁时才会动，没有就是没有。
              </p>
            </div>
          ) : (
            <table className="ledger">
              {/*
                穷举实际存在的行类型，不概括。
                之前写的是「每条都对应一次链上 PlanExecuted」，而表里同时有
                PlanRecorded（容差内未交易）—— 那句话对第二行是假的。
                这是同一类错误的第三次（PlanCommitted、把 Recorded 当卖出、这句）。
              */}
              <caption>
                每行对应一次链上计划事件：PlanExecuted（已成交）或 PlanRecorded（容差内未交易）
              </caption>
              <thead>
                <tr>
                  <th scope="col">块</th>
                  <th scope="col">方向</th>
                  <th scope="col" className="r">
                    USDC
                  </th>
                  <th scope="col" className="r">
                    目标 → 实际占比
                  </th>
                  <th scope="col">计划哈希</th>
                </tr>
              </thead>
              <tbody>
                {strategy.map((r) => (
                  <tr key={`${r.txHash}-${r.logIndex}`}>
                    <td className="num">{r.blockNumber.toString()}</td>
                    <td>
                      {/*
                        三态，不是二态。
                        PlanRecorded = 计划已记录但未交易（实际偏离目标在容差内）。
                        之前写 r.usdcIn ? "买入" : "卖出" 把 null 当成了"卖出" ——
                        缺失被读成了否定，于是"没交易"显示成"卖了 WETH"。
                      */}
                      <span className="dir" data-kind={r.kind === "PlanRecorded" ? "none" : r.usdcIn ? "buy" : "sell"}>
                        <Icon
                          name={r.kind === "PlanRecorded" ? "none" : r.usdcIn ? "up" : "down"}
                          size={13}
                        />
                        {r.kind === "PlanRecorded"
                          ? "未交易"
                          : r.usdcIn
                            ? "买入 WETH"
                            : "卖出 WETH"}
                      </span>
                    </td>
                    <td className="r num">
                      {r.kind === "PlanRecorded"
                        ? "容差内"
                        : r.usdcIn !== null
                          ? `+${fixed(r.usdcIn, 6)}`
                          : r.usdcOut !== null
                            ? `−${fixed(r.usdcOut, 6)}`
                            : "—"}
                    </td>
                    <td className="r num">
                      {/* 字段存的是 bps（1500 = 15%），先换算成百分比再显示，否则会是 1500% */}
                      {r.targetWethBps === null ? "—" : `${percentOf(r.targetWethBps)} → `}
                      {r.actualWethBps === null ? "—" : percentOf(r.actualWethBps)}
                    </td>
                    <td className="num">{r.planHash ? shortHex(r.planHash, 8, 4) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel span-4" aria-labelledby="liq-title">
          <div className="panel__head">
            <h2 className="panel-title" id="liq-title">
              流动性调整
            </h2>
            <span className="pill">{liquidity.length} 笔</span>
          </div>
          {liquidity.length === 0 ? (
            <div className="empty">
              <Icon name="check" size={22} className="empty__icon" />
              <p className="empty__title">本期 0 笔 · 正常</p>
              <p className="empty__msg">
                未发生「赎回超过现金」，故未触发自动卖出。此流必须存在 ——
                否则真实卖出时持仓会变而日志查不到。
              </p>
            </div>
          ) : (
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">块</th>
                  <th scope="col" className="r">
                    卖出 WETH
                  </th>
                  <th scope="col" className="r">
                    得 USDC
                  </th>
                </tr>
              </thead>
              <tbody>
                {liquidity.map((r) => (
                  <tr key={`${r.txHash}-${r.logIndex}`}>
                    <td className="num">{r.blockNumber.toString()}</td>
                    <td className="r num">
                      {r.wethIn === null ? "—" : fixed(r.wethIn, 6)}
                    </td>
                    <td className="r num">
                      {r.usdcOut === null ? "—" : fixed(r.usdcOut, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel panel--linen span-12" aria-labelledby="recon-title">
          <div className="panel__head">
            <h2 className="panel-title" id="recon-title">
              对账 · 第一层（差分闭合，不依赖价格）
            </h2>
          </div>
          {!history ? (
            <div className="empty">
              <p className="empty__title">无法对账</p>
              <p className="empty__msg">
                {data.history.ok ? "—" : data.history.reason}
              </p>
            </div>
          ) : (
            <>
              <p className="recon__num">
                {history.reconciliation.balanced ? "闭合" : "不闭合"}
              </p>
              <div className="recon__checks">
                {history.reconciliation.lines.map((line) => (
                  <div className="recon__row" key={line.label}>
                    <p className="recon__label">
                      {line.label}
                      <span className="recon__tone" data-tone={line.balanced ? "ok" : "err"}>
                        {line.balanced ? "平衡" : "不平衡"}
                      </span>
                    </p>
                    <p className="recon__eq mono">{line.equation}</p>
                    <p className="recon__vals mono">
                      <span>{line.left}</span>
                      <span className="recon__vs">vs</span>
                      <span>{line.right}</span>
                    </p>
                    <p className="recon__detail">{line.detail}</p>
                  </div>
                ))}
              </div>
              <div className="ifields">
                <span className="ifield">
                  <Icon name="info" size={14} className="ifield__icon" />
                  <span className="ifield__value">
                    balance(N) − balance(deployBlock−1) == Transfer.in − out
                  </span>
                </span>
                <span className="ifield">
                  <Icon name="hash" size={14} className="ifield__icon" />
                  <span className="ifield__value">仅 topic0 + from/to == 金库</span>
                </span>
                <span className="ifield" data-tone="warn">
                  <Icon name="warn" size={14} className="ifield__icon" />
                  <span className="ifield__value">第二层（价格 / 滑点 / 费用）本版未做</span>
                </span>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
