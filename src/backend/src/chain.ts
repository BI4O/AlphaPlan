import { createPublicClient, http, parseAbi, parseAbiItem } from "viem";
import { baseSepolia } from "viem/chains";

/**
 * Onchain reads shared by the debate layer, the plan server and verify.
 *
 * One place decides what "now" and "the last executed plan" mean, so the three
 * consumers cannot disagree. The chain is authoritative for both: on a fork
 * without automine the head block freezes between transactions, so a wall-clock
 * "now" is routinely minutes ahead of what the vault will see.
 */

export const DEFAULT_RPC = process.env.RPC_URL ?? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

const client = (rpcUrl: string) => createPublicClient({ chain: baseSepolia, transport: http(rpcUrl, { timeout: 15_000 }) });

export const vaultAbi = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function currentWethBps() view returns (uint16)",
  "function lastNonce() view returns (uint64)",
  "function lastPlan() view returns (bytes32 lastPlanHash, uint16 lastTargetWethBps, uint64 lastNonce)",
  "function planUsed(bytes32 planHash) view returns (bool)",
]);

/** Both events carry the plan fields; the trade path emits Executed, tolerance path Recorded. */
export const planEvents = [
  parseAbiItem(
    "event PlanExecuted(bytes32 indexed reportHash, bytes32 indexed planHash, uint64 asOf, uint64 validUntil, uint16 targetWethBps, uint16 actualWethBps, uint256 usdcIn, uint256 wethIn, uint64 nonce)",
  ),
  parseAbiItem(
    "event PlanRecorded(bytes32 indexed reportHash, bytes32 indexed planHash, uint64 asOf, uint64 validUntil, uint16 targetWethBps, uint16 actualWethBps, uint64 nonce)",
  ),
] as const;

export const ZERO_HASH = `0x${"0".repeat(64)}` as const;

/** Head-block timestamp: the only correct "now" for this project. */
export async function readChainTime(rpcUrl = DEFAULT_RPC): Promise<number> {
  const block = await client(rpcUrl).getBlock({ blockTag: "latest" });
  return Number(block.timestamp);
}

export type ChainState = {
  /** The plan the vault last executed; zero when nothing has run yet. */
  lastPlanHash: `0x${string}`;
  lastTargetWethBps: number;
  lastNonce: number;
  chainNow: number;
};

/** Vault's own record of the last executed plan, plus the head timestamp. */
export async function readChainState(vault: `0x${string}`, rpcUrl = DEFAULT_RPC): Promise<ChainState> {
  const publicClient = client(rpcUrl);
  const [plan, block] = await Promise.all([
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "lastPlan" }),
    publicClient.getBlock({ blockTag: "latest" }),
  ]);

  const [lastPlanHash, lastTargetWethBps, lastNonce] = plan;
  return { lastPlanHash, lastTargetWethBps: Number(lastTargetWethBps), lastNonce: Number(lastNonce), chainNow: Number(block.timestamp) };
}

/** Has this exact plan already been reported? The vault's replay guard. */
export async function readPlanUsed(vault: `0x${string}`, planHash: `0x${string}`, rpcUrl = DEFAULT_RPC): Promise<boolean> {
  return client(rpcUrl).readContract({ address: vault, abi: vaultAbi, functionName: "planUsed", args: [planHash] });
}

export type PlanExecution = {
  kind: "PlanExecuted" | "PlanRecorded";
  planHash: `0x${string}`;
  asOf: number;
  validUntil: number;
  targetWethBps: number;
  actualWethBps: number;
  nonce: number;
  txHash: `0x${string}`;
};

/**
 * Every plan the vault has reported, oldest first.
 *
 * `DEPLOY_BLOCK` bounds the scan: on a fork the chain height is in the tens of
 * millions, so scanning from genesis is not viable. Without it we look back a
 * bounded window and say so, rather than silently returning a partial answer.
 */
export async function readExecutions(
  vault: `0x${string}`,
  rpcUrl = DEFAULT_RPC,
  options: { deployBlock?: number; lookback?: number } = {},
): Promise<{ executions: PlanExecution[]; fromBlock: number; complete: boolean }> {
  const publicClient = client(rpcUrl);
  const latest = await publicClient.getBlockNumber();

  const lookback = BigInt(options.lookback ?? 50_000);
  const fromBlock = options.deployBlock !== undefined ? BigInt(options.deployBlock) : latest > lookback ? latest - lookback : 0n;

  const logs = await publicClient.getLogs({ address: vault, events: planEvents, fromBlock, toBlock: latest });

  const executions: PlanExecution[] = logs
    .map((log) => {
      const args = log.args as {
        planHash: `0x${string}`;
        asOf: bigint;
        validUntil: bigint;
        targetWethBps: number;
        actualWethBps: number;
        nonce: bigint;
      };
      return {
        kind: log.eventName as PlanExecution["kind"],
        planHash: args.planHash,
        asOf: Number(args.asOf),
        validUntil: Number(args.validUntil),
        targetWethBps: Number(args.targetWethBps),
        actualWethBps: Number(args.actualWethBps),
        nonce: Number(args.nonce),
        txHash: log.transactionHash,
      };
    })
    .sort((a, b) => a.nonce - b.nonce);

  return {
    executions,
    fromBlock: Number(fromBlock),
    // "Complete" means the scan covered the vault's whole life.
    complete: options.deployBlock !== undefined,
  };
}
