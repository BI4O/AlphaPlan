"use client";

import { useState } from "react";
import { decodeEventLog, formatUnits, parseUnits, type Address, type Log } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";

import { alphaPlanVaultAbi } from "@/lib/abi/alphaPlanVault";
import { erc20Abi, describeRevert, STEP_LABEL } from "@/lib/wallet/tx";
import { localChain } from "@/lib/wallet/chain";

import { useIsClient } from "@/lib/use-is-client";

import { human, useFundData } from "./use-fund-data";

/**
 * 交易状态机。
 *
 * 六态是硬要求 —— 少一个用户就分不清「在等钱包」和「在等链」：
 *   idle       没开始
 *   pending    钱包弹窗已开，等用户确认（此时链上什么都没发生）
 *   confirming 用户已签，等打包（此时不能重复提交）
 *   success    已确认，给出这笔交易实际成交的数量与 hash
 *   rejected   用户自己取消（不是错误，不要说"失败"）
 *   failed     链上 revert，带解出来的人话
 *
 * rejected 与 failed 必须分开：用户主动拒绝是**预期行为**，把弹窗关掉
 * 和「金库拒绝了你的请求」是两件完全不同的事，混在一起会让用户以为系统坏了。
 */
type TxState =
  | { kind: "idle" }
  | { kind: "pending"; step: string }
  | { kind: "confirming"; step: string; hash: `0x${string}` }
  | { kind: "success"; step: string; hash: `0x${string}`; detail: string }
  | { kind: "rejected" }
  | { kind: "failed"; step: string; message: string };

type Mode = "deposit" | "redeem";

export function FundActions({
  vault,
  usdc,
  decimals,
  shareDecimals,
  assetSymbol,
  shareSymbol,
  onDone,
}: {
  vault: Address;
  usdc: Address;
  decimals: number;
  shareDecimals: number;
  assetSymbol: string;
  shareSymbol: string;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>("deposit");
  const [amount, setAmount] = useState("");
  const [tx, setTx] = useState<TxState>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  /** 交易成功后 +1，让 useFundData 重读四个数。 */
  const [nonce, setNonce] = useState(0);

  const { address, isConnected } = useAccount();
  /*
    钱包状态只在客户端存在：服务端渲染时 isConnected 恒为 false，
    hydrate 后立刻变 true。所以「连没连」这个判断不能直接用 ——
    那会让服务端渲染一个分支、客户端渲染另一个，React 报 hydration mismatch。
    先用 isClient 把两边对齐到「未就绪」，等挂载后再说真话。
  */
  const isClient = useIsClient();
  /** 真的可以按钱包状态渲染了吗。服务端与 hydration 期间都是 false。 */
  const walletKnown = isClient && isConnected;
  const publicClient = usePublicClient({ chainId: localChain.id });
  const { writeContractAsync } = useWriteContract();

  // 四个数一律自己读链，不吃父组件传的 null —— 见 use-fund-data.ts 顶部的说明。
  const fund = useFundData({ vault, usdc, shareDecimals, nonce });

  const unit = mode === "deposit" ? decimals : shareDecimals;
  const unitSymbol = mode === "deposit" ? assetSymbol : shareSymbol;

  const parsed = parseAmount(amount, unit);
  const heldShares = fund.redeemLimit?.held ?? fund.shareBalance;
  const maxShares = fund.redeemLimit?.shares ?? null;

  /** 只对「能确定是超了」的情况报错；读不到就别说超了。 */
  const overHeld =
    mode === "redeem" && heldShares !== null && parsed !== null && parsed > heldShares;
  const overLimit =
    mode === "redeem" && maxShares !== null && parsed !== null && parsed > maxShares;
  const overBalance =
    mode === "deposit" && fund.usdcBalance !== null && parsed !== null && parsed > fund.usdcBalance;

  const needsApprove =
    mode === "deposit" &&
    parsed !== null &&
    fund.allowance !== null &&
    fund.allowance < parsed;

  const blocked = !isConnected || busy || parsed === null || overHeld || overLimit || overBalance;

  const refreshAfter = () => {
    setNonce((n) => n + 1);
    onDone();
  };

  const run = async () => {
    const amountRaw = parseAmount(amount, unit);
    if (!address || !publicClient || amountRaw === null) return;
    setBusy(true);

    try {
      if (mode === "deposit") {
        // allowance 现读一次：用户可能在上一次批准之后又撤了授权，
        // 或者批准的额度小于这次输入。用面板上那份缓存值决定要不要 approve 会漏这种情况。
        let allowance: bigint | null = null;
        try {
          allowance = (await publicClient.readContract({
            address: usdc,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, vault],
          })) as bigint;
        } catch {
          allowance = null;
        }

        if (allowance !== null && allowance < amountRaw) {
          setTx({ kind: "pending", step: STEP_LABEL.approve });
          let h: `0x${string}`;
          try {
            h = await writeContractAsync({
              address: usdc,
              abi: erc20Abi,
              functionName: "approve",
              args: [vault, amountRaw],
              chainId: localChain.id,
            });
          } catch (e) {
            setTx(rejectOrFail(e, STEP_LABEL.approve));
            return;
          }
          setTx({ kind: "confirming", step: STEP_LABEL.approve, hash: h });
          const r1 = await publicClient.waitForTransactionReceipt({ hash: h });
          if (r1.status !== "success") {
            setTx({ kind: "failed", step: STEP_LABEL.approve, message: "授权交易上链失败" });
            return;
          }
        }

        setTx({ kind: "pending", step: STEP_LABEL.deposit });
        let h2: `0x${string}`;
        try {
          h2 = await writeContractAsync({
            address: vault,
            abi: alphaPlanVaultAbi,
            functionName: "deposit",
            args: [amountRaw, address],
            chainId: localChain.id,
          });
        } catch (e) {
          setTx(rejectOrFail(e, STEP_LABEL.deposit));
          return;
        }
        setTx({ kind: "confirming", step: STEP_LABEL.deposit, hash: h2 });
        const r2 = await publicClient.waitForTransactionReceipt({ hash: h2 });
        if (r2.status !== "success") {
          setTx({ kind: "failed", step: STEP_LABEL.deposit, message: "申购交易上链失败" });
          return;
        }

        // 份额从 Deposit 事件里取，不用 previewDeposit 估。
        // 预估和实际会差（份额价随 NAV 变），用户看到的应该是**真实到手**的。
        const minted = findDepositShares(r2.logs, vault, address);
        setTx({
          kind: "success",
          step: STEP_LABEL.deposit,
          hash: h2,
          detail:
            minted !== null
              ? `已投入 ${trimZeros(formatUnits(amountRaw, decimals))} ${assetSymbol}，收到 ${trimZeros(formatUnits(minted, shareDecimals))} ${shareSymbol}`
              : `已投入 ${trimZeros(formatUnits(amountRaw, decimals))} ${assetSymbol}`,
        });
        setAmount("");
        refreshAfter();
        return;
      }

      // ── 赎回 ──
      setTx({ kind: "pending", step: STEP_LABEL.redeem });
      let h3: `0x${string}`;
      try {
        h3 = await writeContractAsync({
          address: vault,
          abi: alphaPlanVaultAbi,
          functionName: "redeem",
          args: [amountRaw, address, address],
          chainId: localChain.id,
        });
      } catch (e) {
        setTx(rejectOrFail(e, STEP_LABEL.redeem));
        return;
      }
      setTx({ kind: "confirming", step: STEP_LABEL.redeem, hash: h3 });
      const r3 = await publicClient.waitForTransactionReceipt({ hash: h3 });
      if (r3.status !== "success") {
        setTx({ kind: "failed", step: STEP_LABEL.redeem, message: "赎回交易上链失败" });
        return;
      }

      // 赎回可能触发自动卖 WETH（现金不足时）。从 receipt 里解 LiquiditySold。
      const sold = findLiquiditySold(r3.logs, vault);
      const got = findWithdrawAssets(r3.logs, vault);
      setTx({
        kind: "success",
        step: STEP_LABEL.redeem,
        hash: h3,
        detail:
          `已赎回 ${trimZeros(formatUnits(amountRaw, shareDecimals))} ${shareSymbol}` +
          (got !== null ? `，拿到 ${trimZeros(formatUnits(got, decimals))} ${assetSymbol}` : "") +
          (sold
            ? ` · 现金不足，期间自动卖出 ${trimZeros(formatUnits(sold.wethIn, 18))} WETH 换回 ${trimZeros(formatUnits(sold.usdcOut, decimals))} ${assetSymbol}`
            : ""),
      });
      setAmount("");
      refreshAfter();
      return;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="trade">
      <div className="trade__tabs" role="tablist">
        <button
          className="trade__tab"
          role="tab"
          aria-selected={mode === "deposit"}
          type="button"
          onClick={() => {
            setMode("deposit");
            setAmount("");
            setTx({ kind: "idle" });
          }}
        >
          申购
        </button>
        <button
          className="trade__tab"
          role="tab"
          aria-selected={mode === "redeem"}
          type="button"
          onClick={() => {
            setMode("redeem");
            setAmount("");
            setTx({ kind: "idle" });
          }}
        >
          赎回
        </button>
      </div>

      <label className="trade__field">
        <span className="trade__label">{mode === "deposit" ? "投入" : "赎回"}数量</span>
        <div className="trade__input-row">
          <input
            className="input mono"
            inputMode="decimal"
            placeholder="0.00"
            aria-invalid={overHeld || overLimit || overBalance ? true : undefined}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <span className="trade__unit">{unitSymbol}</span>
          {mode === "redeem" && maxShares !== null && maxShares > 0n ? (
            <button
              className="link-btn"
              type="button"
              onClick={() => setAmount(trimZeros(formatUnits(maxShares, shareDecimals)))}
              title={
                fund.redeemLimit?.limitedByLiquidity
                  ? "填入现金 + 可变现 WETH 能覆盖的上限，不是你的全部份额"
                  : "填入你持有的全部份额"
              }
            >
              全部
            </button>
          ) : null}
          {mode === "deposit" && fund.usdcBalance !== null && fund.usdcBalance > 0n ? (
            <button
              className="link-btn"
              type="button"
              onClick={() => setAmount(trimZeros(formatUnits(fund.usdcBalance!, decimals)))}
            >
              全部
            </button>
          ) : null}
        </div>
      </label>

      {/* 余额与授权：工单要求「显示当前 allowance、需要的 approve 状态」 */}
      <dl className="trade__kv">
        {mode === "deposit" ? (
          <>
            <div>
              <dt>钱包 {assetSymbol}</dt>
              <dd className="mono">
                {walletKnown ? (human(fund.usdcBalance, decimals) ?? "—") : "—"}
              </dd>
            </div>
            <div>
              <dt>已授权给金库</dt>
              <dd className="mono">
                {!walletKnown ? (
                  "—"
                ) : fund.loading ? (
                  // 还在读就说「读取中」。之前这里会落到「读取失败」——
                  // hydration bug 的另一半正是这个：null 同时表示
                  // 「没连」「还没读」「读失败」三件事，UI 把它们读成同一件。
                  <span className="trade__state">读取中…</span>
                ) : fund.readError ? (
                  <span className="trade__state" data-tone="warn" title={fund.readError}>
                    读取失败
                  </span>
                ) : (
                  `${human(fund.allowance, decimals)} ${assetSymbol}`
                )}
              </dd>
            </div>
            <div>
              <dt>本次需要</dt>
              <dd>
                {!walletKnown ? (
                  <span className="trade__state">连接钱包后可见</span>
                ) : parsed === null ? (
                  <span className="trade__state">填入数量后可见</span>
                ) : needsApprove ? (
                  <span className="trade__state" data-tone="warn">
                    两笔交易：先授权 {trimZeros(formatUnits(parsed, decimals))} {assetSymbol}，再申购
                  </span>
                ) : (
                  <span className="trade__state" data-tone="ok">
                    一笔交易：授权已足够，直接申购
                  </span>
                )}
              </dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>持有份额</dt>
              <dd className="mono">
                {walletKnown ? (human(heldShares, shareDecimals) ?? "—") : "—"} {shareSymbol}
              </dd>
            </div>
            <div>
              <dt>现在可赎回</dt>
              <dd className="mono">
                {!walletKnown ? (
                  "—"
                ) : fund.redeemLimitError ? (
                  <span className="trade__state" data-tone="warn" title={fund.redeemLimitError}>
                    无法读取
                  </span>
                ) : maxShares === null ? (
                  "—"
                ) : (
                  <>
                    {human(maxShares, shareDecimals)} {shareSymbol}
                    {fund.redeemLimit
                      ? ` ≈ ${human(fund.redeemLimit.assets, decimals)} ${assetSymbol}`
                      : ""}
                  </>
                )}
              </dd>
            </div>
          </>
        )}
      </dl>

      {/*
        「全部」为什么不是「全部份额」—— 这必须解释，否则用户会以为我们吞了他的钱。
        合约事实：redeem 要付的 USDC 超过「现金 + WETH 按 oracle 价扣 50bps 滑点」
        时直接 revert InsufficientLiquidity。差额是 WETH 那部分的滑点成本。
      */}
      {mode === "redeem" && fund.redeemLimit?.limitedByLiquidity ? (
        <p className="trade__note">
          「全部」填的是<strong>可实现上限</strong>，比你持有的份额少{" "}
          <span className="mono">
            {human(fund.redeemLimit.gapShares, shareDecimals)} {shareSymbol}
          </span>
          （约 {human(fund.redeemLimit.gapAssets, decimals)} {assetSymbol}）。
          原因：赎回要付的 USDC 超过「现金 + WETH 可变现」，合约会以{" "}
          <code>InsufficientLiquidity</code> 拒绝。差额是卖出 WETH 的滑点成本。
        </p>
      ) : null}

      {overHeld ? (
        <p className="trade__warn">超过你持有的份额（{human(heldShares, shareDecimals)}）</p>
      ) : overLimit ? (
        <p className="trade__warn">
          超过现在可赎回的上限（{human(maxShares, shareDecimals)}）。现金之外的部分要卖 WETH，
          超过可实现的量就会失败。
        </p>
      ) : overBalance ? (
        <p className="trade__warn">
          超过钱包余额（{human(fund.usdcBalance, decimals)} {assetSymbol}）
        </p>
      ) : null}

      <button
        className="btn-primary trade__go"
        type="button"
        disabled={blocked}
        onClick={() => void run()}
      >
        {!walletKnown
          ? "先连接钱包"
          : busy
            ? "处理中…"
            : mode === "deposit"
              ? needsApprove
                ? "授权并申购"
                : "申购"
              : "赎回"}
      </button>

      <StatusBlock tx={tx} />

      <p className="trade__fine">
        若 USDC 授权不足，需要<strong>两笔交易</strong>（先授权、再申购）。
        赎回时若现金不足，合约会自动卖出 WETH —— 那不是计划交易，会在流水里单列。
      </p>
    </div>
  );
}

function StatusBlock({ tx }: { tx: TxState }) {
  if (tx.kind === "idle") return null;

  const tone =
    tx.kind === "success"
      ? "ok"
      : tx.kind === "rejected"
        ? "warn"
        : tx.kind === "failed"
          ? "err"
          : "muted";

  return (
    <div className="txstate" data-tone={tone} role="status" aria-live="polite">
      <p className="txstate__line">
        <span className="txstate__dot" aria-hidden="true" />
        {tx.kind === "pending" ? <>{tx.step} · 等待钱包确认</> : null}
        {tx.kind === "confirming" ? <>{tx.step} · 已提交，等待上链</> : null}
        {tx.kind === "success" ? <>{tx.detail}</> : null}
        {tx.kind === "rejected" ? <>你取消了交易，链上没有任何变化</> : null}
        {tx.kind === "failed" ? <>{tx.message}</> : null}
      </p>
      {tx.kind === "confirming" || tx.kind === "success" ? (
        <p className="txstate__hash mono">{tx.hash}</p>
      ) : null}
      {tx.kind === "failed" ? <p className="txstate__step">{tx.step}</p> : null}
    </div>
  );
}

/** 用户拒绝 ≠ 失败。describeRevert 已经能认出 Rejected，这里只做映射。 */
function rejectOrFail(e: unknown, step: string): TxState {
  const d = describeRevert(e);
  if (d.kind === "Rejected") return { kind: "rejected" };
  return { kind: "failed", step, message: d.message };
}

/**
 * 解析输入数量。
 *
 * 用 `parseUnits` 的结果判空，不用 `Number(v) > 0`：浮点判断对
 * `0.0000001`（小于 1 个最小单位）会返回「有效」，然后 parseUnits 抛异常；
 * 而对 `1e-7` 这种科学计数法字符串 Number 会给出正数，UI 却提交不了。
 */
function parseAmount(v: string, decimals: number): bigint | null {
  const t = v.trim();
  if (!t) return null;
  if (!/^\d*\.?\d*$/.test(t)) return null;
  try {
    const raw = parseUnits(t, decimals);
    return raw > 0n ? raw : null;
  } catch {
    return null;
  }
}

function trimZeros(s: string): string {
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}

/** 从 Deposit 事件取实际铸出的份额（sender/owner 都是借款人本人）。 */
function findDepositShares(
  logs: readonly Log[],
  vault: Address,
  owner: Address,
): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== vault.toLowerCase()) continue;
    try {
      const d = decodeEventLog({
        abi: alphaPlanVaultAbi,
        data: log.data,
        topics: log.topics,
      });
      if (d.eventName === "Deposit") {
        const args = d.args as { owner?: Address; shares?: bigint };
        if (args.owner && args.owner.toLowerCase() !== owner.toLowerCase()) continue;
        if (typeof args.shares === "bigint") return args.shares;
      }
    } catch {
      // 不是本 ABI 的事件（ERC20 Transfer 也可能同地址），跳过
    }
  }
  return null;
}

/** 从 Withdraw 事件取实际付出的资产数量。 */
function findWithdrawAssets(logs: readonly Log[], vault: Address): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== vault.toLowerCase()) continue;
    try {
      const d = decodeEventLog({ abi: alphaPlanVaultAbi, data: log.data, topics: log.topics });
      if (d.eventName === "Withdraw") {
        const args = d.args as { assets?: bigint };
        if (typeof args.assets === "bigint") return args.assets;
      }
    } catch {
      /* 跳过 */
    }
  }
  return null;
}

/**
 * 从 receipt 里解 LiquiditySold（现金不足时自动卖 WETH 的证据）。
 *
 * 用 decodeEventLog 而不是手写 topic0：手写常量在合约改动签名时会**静默失效**
 * （新 topic 不匹配 → 永远返回 null → UI 永远不显示"已自动卖出"），
 * 而 decodeEventLog 直接吃 ABI，ABI 更新时行为跟着更新。
 */
function findLiquiditySold(
  logs: readonly Log[],
  vault: Address,
): { wethIn: bigint; usdcOut: bigint } | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== vault.toLowerCase()) continue;
    try {
      const d = decodeEventLog({ abi: alphaPlanVaultAbi, data: log.data, topics: log.topics });
      if (d.eventName === "LiquiditySold") {
        const args = d.args as { wethIn?: bigint; usdcOut?: bigint };
        if (typeof args.wethIn === "bigint" && typeof args.usdcOut === "bigint") {
          return { wethIn: args.wethIn, usdcOut: args.usdcOut };
        }
      }
    } catch {
      /* 跳过 */
    }
  }
  return null;
}
