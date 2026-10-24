"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { erc20Abi } from "@/lib/wallet/tx";
import { localChain } from "@/lib/wallet/chain";

import { readRedeemLimit, type RedeemLimit } from "./redeem-limit";

/**
 * 申赎面板要读的四个数：USDC 余额、USDC 授权额度、持有份额、可赎回上限。
 *
 * ## 为什么不让父组件（book.tsx）把数字传进来
 *
 * 上一版是 `walletShares={null}` 硬编码 —— 因为服务端快照不知道**谁**连着钱包。
 * 结果「全部」按钮的 `walletShares !== null` 永远为假，赎回功能等于没做，
 * 而 `pnpm build` 和 `tsc` 都是绿的（null 是合法值，类型检查器不会抱怨
 * 「这个值永远是 null」）。
 *
 * 更好的是：这些数**只在钱包连上之后才有意义**，那就由组件自己读。
 * 父组件不必知道链上细节，也就没有「传 null 还是传 0」这种分不清的语义。
 *
 * ## 为什么每个数都单独降级
 *
 * `readRedeemLimit` 要读 7 个合约值，其中一个 revert（例如 feed 过期导致
 * `ethPrice()` 抛 StalePrice）就会整块失败。但「USDC 余额」并不依赖 feed ——
 * 因为一个数读不到就把四个数全变成「—」，用户会以为钱包没连上。
 */
export type FundData = {
  usdcBalance: bigint | null;
  allowance: bigint | null;
  shareBalance: bigint | null;
  redeemLimit: RedeemLimit | null;
  /** 可赎回上限读失败的原因。有值时必须显示给用户，不能只是「—」。 */
  redeemLimitError: string | null;
  /**
   * 三个基础数值有没有真的读失败过。
   *
   * `null` 在这套类型里同时表示三件事：「没连钱包」「还在读」「读失败」——
   * 那是 hydration bug 的另一半：还没读就显示「读取失败」，是在陈述一件
   * 没发生过的事。加这个字段把三者分开：
   *
   *   loading=true            → 还在读
   *   loading=false, error=空, 值=null → 没连钱包（没读）
   *   error 有值              → 真的读失败了
   */
  readError: string | null;
  loading: boolean;
};

const EMPTY: FundData = {
  usdcBalance: null,
  allowance: null,
  shareBalance: null,
  redeemLimit: null,
  redeemLimitError: null,
  readError: null,
  loading: false,
};

export function useFundData(args: {
  vault: Address;
  usdc: Address;
  shareDecimals: number;
  /** 交易成功后 +1，触发重新读取。 */
  nonce: number;
}): FundData & { reload: () => void } {
  const { vault, usdc, shareDecimals, nonce } = args;
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: localChain.id });

  const [data, setData] = useState<FundData>(EMPTY);
  const [localNonce, setLocalNonce] = useState(0);

  const reload = useCallback(() => setLocalNonce((n) => n + 1), []);

  useEffect(() => {
    /*
      这个 effect 的职责是「订阅外部系统（链）并在回调里 setState」。
      但它在**同步路径**里有两次 setState（断连时清空、开始时置 loading），
      会触发 cascading render —— react-hooks/set-state-in-effect 报的正是这个。

      修法不是删掉这两次更新（那会让 UI 停在旧数据上），而是让它们
      也走异步那条路：
        · 断连的分支交给一个立即 resolve 的微任务
        · loading 与结果一起在 async 体里设置
      这样 effect 同步体内不再有 setState，而行为完全不变。
    */
    let cancelled = false;

    if (!address || !isConnected || !publicClient) {
      queueMicrotask(() => {
        if (!cancelled) setData(EMPTY);
      });
      return () => {
        cancelled = true;
      };
    }

    // 组件卸载/换地址后回来的响应必须丢弃，否则会把旧地址的余额贴到新地址上

    void (async () => {
      if (cancelled) return;
      setData((d) => ({ ...d, loading: true }));

      // 返回 {value} 或 {error} 而不是 null —— 因为调用方需要区分
      // 「读到了 0」和「读失败了」。之前一律返回 null，于是 UI 只能把
      // null 当「读失败」显示，可 loading 期间它其实还没读。
      const readErc20 = async (
        functionName: "balanceOf" | "allowance",
        fargs: readonly unknown[],
      ): Promise<{ value: bigint | null; error: string | null }> => {
        try {
          const value = (await publicClient.readContract({
            address: usdc,
            abi: erc20Abi,
            functionName,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            args: fargs as any,
          })) as bigint;
          return { value, error: null };
        } catch (e: unknown) {
          return { value: null, error: shortReason(e) };
        }
      };

      const [usdcRead, allowanceRead, shareRead, limitResult] = await Promise.all([
        readErc20("balanceOf", [address]),
        readErc20("allowance", [address, vault]),
        (async (): Promise<{ value: bigint | null; error: string | null }> => {
          try {
            const value = (await publicClient.readContract({
              address: vault,
              abi: [
                {
                  type: "function",
                  name: "balanceOf",
                  stateMutability: "view",
                  inputs: [{ name: "account", type: "address" }],
                  outputs: [{ type: "uint256" }],
                },
              ] as const,
              functionName: "balanceOf",
              args: [address],
            })) as bigint;
            return { value, error: null };
          } catch (e: unknown) {
            return { value: null, error: shortReason(e) };
          }
        })(),
        readRedeemLimit({ client: publicClient, vault, investor: address, shareDecimals })
          .then((v) => ({ ok: true as const, value: v }))
          .catch((e: unknown) => ({ ok: false as const, reason: shortReason(e) })),
      ]);

      if (cancelled) return;

      // 三条里任一条失败，就把第一条失败原因抬到 readError ——
      // UI 拿到的是「读失败了，原因是 X」，而不是一个没法区分的 null。
      const firstError =
        usdcRead.error ?? allowanceRead.error ?? shareRead.error ?? null;

      setData({
        usdcBalance: usdcRead.value,
        allowance: allowanceRead.value,
        shareBalance: shareRead.value,
        redeemLimit: limitResult.ok ? limitResult.value : null,
        redeemLimitError: limitResult.ok ? null : limitResult.reason,
        readError: firstError,
        loading: false,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [address, isConnected, publicClient, usdc, vault, shareDecimals, nonce, localNonce]);

  return { ...data, reload };
}

function shortReason(error: unknown): string {
  if (error && typeof error === "object" && "shortMessage" in error) {
    const s = (error as { shortMessage?: unknown }).shortMessage;
    if (typeof s === "string" && s.length > 0) return s;
  }
  if (error instanceof Error) return error.message.split("\n")[0] ?? error.name;
  return String(error);
}

/** 最小单位 → 可读数字，保留最多 6 位、去掉尾随零。 */
export function human(v: bigint | null, decimals: number): string | null {
  if (v === null) return null;
  const s = formatUnits(v, decimals);
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}
