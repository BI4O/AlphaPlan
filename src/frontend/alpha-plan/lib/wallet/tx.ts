import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  formatUnits,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

import { alphaPlanVaultAbi } from "@/lib/abi/alphaPlanVault";

/** 用户可选的两步流程；把「这是两笔交易」写进类型，UI 就没法悄悄合并。 */
export type Step = "approve" | "deposit" | "redeem";

export const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

/**
 * 把链上 revert 变成人话。
 *
 * 为什么要自己解：viem 抛出来的 BaseError 里，自定义 error 的 4 字节 selector
 * 藏在 `data` 里，`shortMessage` 只说「execution reverted」。直接显示那个，
 * 用户看到的是 "The contract function reverted with the following signature:
 * 0x<random>" —— 对「流动性不足」这种有明确含义的错误等于什么都没说。
 */
export function describeRevert(error: unknown): { message: string; kind: string } {
  // 1) viem 已经解出 revert data 的情况
  let raw: Hex | undefined;
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      // .data 是「已解码」的结果（含 errorName/args）；.raw 才是原始 revert data。
      // 之前写 reverted.data?.data 是错的 —— 那个字段不存在。
      if (reverted.data?.errorName) {
        const { errorName, args } = reverted.data;
        return { message: formatCustomError(errorName, args as readonly unknown[]), kind: errorName };
      }
      raw = reverted.raw;
    }
  }

  // 2) 从 message 里抠 0x 开头的 revert data 再解（不同 provider 包装层级不一样）
  const text = extractText(error);
  const m = text.match(/(0x[0-9a-fA-F]{8,})/);
  if (m) raw = m[1] as Hex;

  if (raw) {
    try {
      const decoded = decodeErrorResult({ abi: alphaPlanVaultAbi, data: raw });
      return {
        message: formatCustomError(decoded.errorName, (decoded.args ?? []) as readonly unknown[]),
        kind: decoded.errorName,
      };
    } catch {
      /* 不是本合约的 error（可能是 USDC 的），往下走 */
    }
  }

  if (/user rejected|denied|rejected the request/i.test(text)) {
    return { message: "你在钱包里取消了这笔交易", kind: "Rejected" };
  }
  if (/insufficient funds/i.test(text)) {
    return { message: "ETH 不足，付不起 gas", kind: "InsufficientFunds" };
  }
  return { message: text.split("\n")[0] || "交易失败", kind: "Unknown" };
}

function extractText(error: unknown, depth = 0): string {
  if (!error || depth > 5) return "";
  if (typeof error === "string") return error;
  if (typeof error !== "object") return String(error);
  const e = error as Record<string, unknown>;
  const parts = [e.shortMessage, e.message, e.details, String(error)];
  if (e.cause) parts.push(extractText(e.cause, depth + 1));
  return parts.filter((p) => typeof p === "string").join(" ");
}

const usdc6 = (v: bigint) => Number(formatUnits(v, 6));

/** 合约里定义的自定义 error → 一句带数字的话。 */
function formatCustomError(name: string, args: readonly unknown[]): string {
  const n = (i: number) => (typeof args[i] === "bigint" ? usdc6(args[i] as bigint) : null);
  switch (name) {
    case "InsufficientLiquidity": {
      const need = n(0);
      const cash = n(1);
      const weth = n(2);
      return `流动性不足：赎回需要 ${need?.toFixed(2)} USDC，现金 ${cash?.toFixed(2)}，WETH 估值 ${weth?.toFixed(2)}`;
    }
    case "ERC4626ExceededMaxRedeem": {
      const max = typeof args[2] === "bigint" ? Number(formatUnits(args[2] as bigint, 6)) : null;
      return `超过可赎回上限：最多 ${max?.toFixed(6)} 份额`;
    }
    case "ERC4626ExceededMaxDeposit": {
      const max = typeof args[2] === "bigint" ? usdc6(args[2] as bigint) : null;
      return `超过可申购上限：最多 ${max?.toFixed(2)} USDC`;
    }
    case "ERC20InsufficientAllowance": {
      const need = typeof args[2] === "bigint" ? usdc6(args[2] as bigint) : null;
      return `USDC 授权不足：需要 ${need?.toFixed(2)}，请先授权`;
    }
    case "ERC20InsufficientBalance": {
      const have = typeof args[1] === "bigint" ? usdc6(args[1] as bigint) : null;
      return `USDC 余额不足：钱包只有 ${have?.toFixed(6)}`;
    }
    case "Paused":
      return "金库已暂停，暂不接受申赎";
    case "ZeroAddress":
      return "地址为零";
    default:
      return `${name}(${args.map((a) => String(a)).join(", ")})`;
  }
}

/** 申购：先算需不需要 approve，再给出明确的两步说明。 */
export async function planDeposit(args: {
  amountUsdc: string;
  owner: Address;
  vault: Address;
  usdc: Address;
  readAllowance: (owner: Address, spender: Address) => Promise<bigint>;
}): Promise<{ needsApprove: boolean; amount: bigint; steps: Step[]; dollars: string }> {
  const amount = parseUnits(args.amountUsdc, 6);
  const allowance = await args.readAllowance(args.owner, args.vault);
  const needsApprove = allowance < amount;
  return {
    needsApprove,
    amount,
    steps: needsApprove ? ["approve", "deposit"] : ["deposit"],
    dollars: args.amountUsdc,
  };
}

export const STEP_LABEL: Record<Step, string> = {
  approve: "1/2 授权 USDC",
  deposit: "2/2 确认申购",
  redeem: "确认赎回",
};
