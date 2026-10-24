import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";

/**
 * 浏览器端的链上读取 —— 只读一个值：`lastPlanHash()`。
 *
 * 为什么客户端要自己读：P1 的卖点是「这个值不是服务器告诉你的」。
 * 如果客户端算完哈希、却拿服务器给的 planHash 去比，那评委有理由不信。
 * 所以这里真的在评委浏览器里发一次 JSON-RPC。
 *
 * 但 RPC 会挂（CORS、限流、断网）。挂的时候**不许静默回退** ——
 * 调用方必须把来源显式显示出来，见 SelfVerify 的两段文案。
 */

const vaultAbi = parseAbi([
  "function lastPlanHash() view returns (bytes32)",
  "function lastNonce() view returns (uint64)",
]);

export type BrowserChainRead =
  | { status: "read"; planHash: `0x${string}`; rpcUrl: string }
  | { status: "failed"; reason: string; rpcUrl: string }
  | { status: "unconfigured"; reason: string };

/** 公开的 Base Sepolia RPC。要换端点就改 NEXT_PUBLIC_RPC_URL（构建期内联）。 */
export function publicRpcUrl(): string {
  return process.env.NEXT_PUBLIC_RPC_URL ?? "https://sepolia.base.org";
}

export async function readLastPlanHashInBrowser(
  vaultAddress: `0x${string}`,
): Promise<BrowserChainRead> {
  const rpcUrl = publicRpcUrl();

  try {
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(rpcUrl, { timeout: 8_000, retryCount: 0 }),
    });

    const planHash = await client.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "lastPlanHash",
    });

    return { status: "read", planHash, rpcUrl };
  } catch (error) {
    const reason =
      error && typeof error === "object" && "shortMessage" in error
        ? String((error as { shortMessage?: unknown }).shortMessage ?? error)
        : error instanceof Error
          ? (error.message.split("\n")[0] ?? error.name)
          : String(error);
    return { status: "failed", reason, rpcUrl };
  }
}
