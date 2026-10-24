import { formatUnits, type Address } from "viem";

import { alphaPlanVaultAbi } from "@/lib/abi/alphaPlanVault";

/**
 * 「最多能赎回多少份额」。
 *
 * ## 为什么不能直接用现成的读数
 *
 * 合约里有两个看起来能用的上限，都不对：
 *
 * 1. `balanceOf(owner)` —— 你持有的全部份额。
 *    但 `redeem()` 走 `_withdraw → _ensureLiquidity`，现金不够要卖 WETH，
 *    卖光还不够就 `revert InsufficientLiquidity`。实测（2026-10-24）：
 *
 *      redeem(20.000000) → InsufficientLiquidity(19990733, 17000000, 2990733)
 *
 *    按 balanceOf 填「全部」，用户**每点必失败**。
 *
 * 2. `maxRedeem(owner)` —— 合约把它定义成「现金能覆盖的部分」：
 *
 *      uint256 cash = IERC20(asset()).balanceOf(address(this));
 *      uint256 sharesForCash = _convertToShares(cash, Math.Rounding.Floor);
 *
 *    完全不计 WETH，**偏保守**。同一次实测里它给 18.005508，而真实可赎是 19.994135
 *    —— 差 1.98 USDC，用户会以为金库扣着钱不还。
 *
 * ## 为什么不能用公式算（这条是实测推翻的，别改回去）
 *
 * 第一版按合约 `_ensureLiquidity` 的准入条件算了这个公式：
 *
 *   maxAssets = cash + wethValue × (1 − SLIPPAGE_BPS)
 *
 * 结果是 19.983911，而链上真实上限对应 19.988017 —— **少算 0.0041 USDC**。
 *
 * 原因：合约的准入检查用 **oracle 价**估 WETH，而真正卖出时走的是
 * **Uniswap 池子价**。两者不同（本仓库 AGENTS.md 记着实测差 55% 的那次），
 * 所以「按 oracle 价的预算」不等于「池子真能换出多少」。公式必然偏保守，
 * 偏保守在「全部」按钮上等于让用户少拿钱 —— 这是会被截图来问的 bug。
 *
 * 唯一准确的口径是**问链本身**：用 `eth_call` 模拟 `redeem(shares)`，
 * 能过就是能过。实测一次 simulate 约 5.8ms，24 次二分共 58ms（本地 RPC），
 * 完全负担得起。
 *
 * ## 判据必须是「模拟通过」而不是「预算够」
 *
 * 判据如果写成 `assets <= maxAssets`，它会在合约改了滑点口径之后**继续绿**，
 * 因为那个预算是我们自己算的，不是合约的。用 simulate 就是把判定权交还给链。
 */

export type RedeemLimit = {
  /** 真的能提交的最大份额（bigint，最小单位）。 */
  shares: bigint;
  /** 同一数量的可读形式，按 shareDecimals 归一。 */
  sharesHuman: string;
  /** 持有总量。 */
  held: bigint;
  /** 赎回 shares 会拿到的 USDC。 */
  assets: bigint;
  /** 现金可覆盖的部分（合约 maxRedeem 的口径），用来解释差额来源。 */
  cashBackedShares: bigint;
  /** 「全部」要少填多少份额 —— 必须向用户解释。 */
  gapShares: bigint;
  /** 差额换算成 USDC，给一个可理解的量级。 */
  gapAssets: bigint;
  /** 是否受流动性限制（false 表示能全额赎回）。 */
  limitedByLiquidity: boolean;
};

/** 最小可用的 client 形状（只依赖我们用到的两个方法，便于测试与复用）。 */
export type RedeemClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readContract: (a: any) => Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  simulateContract: (a: any) => Promise<unknown>;
};

export async function readRedeemLimit(args: {
  client: RedeemClient;
  vault: Address;
  investor: Address;
  shareDecimals: number;
}): Promise<RedeemLimit> {
  const { client, vault, investor, shareDecimals } = args;

  const read = async <T>(functionName: string, fargs?: readonly unknown[]): Promise<T> =>
    (await client.readContract({
      address: vault,
      abi: alphaPlanVaultAbi,
      functionName,
      args: fargs,
    })) as T;

  const held = await read<bigint>("balanceOf", [investor]);

  // 空仓位：不必再问链。这是一条真实的早退，不是错误。
  if (held === 0n) {
    return {
      shares: 0n,
      sharesHuman: "0",
      held: 0n,
      assets: 0n,
      cashBackedShares: 0n,
      gapShares: 0n,
      gapAssets: 0n,
      limitedByLiquidity: false,
    };
  }

  const canRedeem = async (shares: bigint): Promise<boolean> => {
    if (shares <= 0n) return true;
    try {
      await client.simulateContract({
        address: vault,
        abi: alphaPlanVaultAbi,
        functionName: "redeem",
        args: [shares, investor, investor],
        account: investor,
      });
      return true;
    } catch {
      return false;
    }
  };

  // 先试全额。能过就不必二分 —— 大多数正常金库都走这一条。
  let shares = held;
  if (!(await canRedeem(held))) {
    // 二分找最大的可成交份额。区间端点语义：lo 一定成功、hi 一定失败。
    let lo = 0n;
    let hi = held;
    while (lo + 1n < hi) {
      const mid = (lo + hi) / 2n;
      if (await canRedeem(mid)) lo = mid;
      else hi = mid;
    }
    shares = lo;
  }

  const [assets, cashBackedShares] = await Promise.all([
    read<bigint>("previewRedeem", [shares]),
    read<bigint>("maxRedeem", [investor]),
  ]);

  const gapShares = held - shares;
  const gapAssets = gapShares > 0n ? await read<bigint>("previewRedeem", [gapShares]) : 0n;

  return {
    shares,
    sharesHuman: formatUnits(shares, shareDecimals),
    held,
    assets,
    cashBackedShares,
    gapShares,
    gapAssets,
    limitedByLiquidity: gapShares > 0n,
  };
}
