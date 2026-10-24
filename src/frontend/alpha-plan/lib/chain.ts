import { createPublicClient, formatUnits, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";

import { deployBlock, rpcUrl, vaultAddress } from "./env";

/**
 * 服务端链上读取。**只在 Server Component / Route Handler 里用** ——
 * 客户端的 P1 自验会自己建 client（那是另一回事，见计划）。
 *
 * 每一个读都是独立失败态：这些 RPC 在评委面前挂掉时，图上的那一格必须是
 * 「未采集 + 原因」，而不是 0。
 */

/** 读成功 → 值；失败 → 一句能直接显示给人看的原因。 */
export type ChainResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * ETH/USD 喂价地址。来源：PRD §10 已核实表格 = src/backend/src/market.ts 的同一常量。
 * 部署后应改读金库的 `ETH_USD_FEED()`（ABI 里就带这个 getter），
 * 这样地址只有一个权威来源。现在没有金库地址，只能先按已验证值读。
 */
const ETH_USD_FEED = "0xa24A68DD788e1D7eb4CA517765CFb2b7e217e7a3" as const;
const FEED_DECIMALS = 8;

/** 金库的 feed 陈旧阈值（合约 MAX_FEED_STALENESS = 1 hours）。过期会让 totalAssets() revert。 */
const MAX_FEED_STALENESS_SECONDS = 3600;

const aggregatorAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

const vaultAbi = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function currentWethBps() view returns (uint16)",
]);

/** 历史/对账用的 client —— 与快照同一个 RPC，但不带 blockTag 默认值。 */
export function clientForHistory() {
  return client_();
}

/** 部署块号；未配置时为 null（不从创世块扫）。 */
export function deployBlockOrNull(): bigint | null {
  return deployBlock();
}

export function chainName(): string {
  return `${baseSepolia.name} (${baseSepolia.id})`;
}

function client_() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl(), { timeout: 8_000, retryCount: 0 }),
  });
}

/** viem 的报错里 `shortMessage` 最适合直接上屏，不要整段堆栈。 */
function reasonFrom(error: unknown): string {
  if (error && typeof error === "object" && "shortMessage" in error) {
    const short = (error as { shortMessage?: unknown }).shortMessage;
    if (typeof short === "string" && short.length > 0) return short;
  }
  if (error instanceof Error) return error.message.split("\n")[0] ?? error.name;
  return String(error);
}

export type EthPriceReading = {
  priceUsd: number;
  updatedAt: number;
  ageSeconds: number;
  stale: boolean;
  roundId: string;
};

export async function readEthPrice(): Promise<ChainResult<EthPriceReading>> {
  try {
    const [, answer, , updatedAt] = await client_().readContract({
      address: ETH_USD_FEED,
      abi: aggregatorAbi,
      functionName: "latestRoundData",
    });

    const priceUsd = Number(formatUnits(answer, FEED_DECIMALS));
    const updated = Number(updatedAt);
    const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - updated);

    return {
      ok: true,
      value: {
        priceUsd,
        updatedAt: updated,
        ageSeconds,
        stale: ageSeconds > MAX_FEED_STALENESS_SECONDS,
        roundId: `${ETH_USD_FEED}`,
      },
    };
  } catch (error) {
    return { ok: false, reason: reasonFrom(error) };
  }
}

export type VaultReadings = {
  totalAssetsUsdc: number;
  currentWethBps: number;
  address: `0x${string}`;
};

export async function readVaultViews(): Promise<ChainResult<VaultReadings>> {
  const address = vaultAddress();
  if (!address) {
    return { ok: false, reason: "VAULT_ADDRESS 未配置（P4 尚未部署）" };
  }

  try {
    const [totalAssets, currentWethBps] = await Promise.all([
      client_().readContract({ address, abi: vaultAbi, functionName: "totalAssets" }),
      client_().readContract({ address, abi: vaultAbi, functionName: "currentWethBps" }),
    ]);

    return {
      ok: true,
      value: {
        // USDC 是 6 位小数（PRD §10），资产单位从这里出，不手算
        totalAssetsUsdc: Number(formatUnits(totalAssets, 6)),
        currentWethBps: Number(currentWethBps),
        address,
      },
    };
  } catch (error) {
    // 已知的第一杀手：feed 过期 → totalAssets() 现场 revert（ACCEPTANCE 陷阱 1）
    return { ok: false, reason: reasonFrom(error) };
  }
}

/* ───────────────────────── 金库快照（P2） ───────────────────────── */

const vaultSnapshotAbi = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function currentWethBps() view returns (uint16)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function asset() view returns (address)",
  "function WETH() view returns (address)",
  "function maxRedeem(address) view returns (uint256)",
]);

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

/**
 * 一次请求内的金库快照。
 *
 * **所有读都用同一个 blockNumber**：先取 N，再把 N 同时用作每个 view 的 blockTag。
 * 否则「totalAssets 读到现在、balanceOf 读到刚才」会让百分比与 NAV 互相打架，
 * 差一个块的赎回就足以让数字对不上（这类错在评委面前解释不清）。
 */
export type VaultSnapshot = {
  blockNumber: bigint;
  blockTimestamp: number;
  vault: `0x${string}`;
  /** 资产口径按 ERC20 decimals 归一，不手算 1e6/1e18 */
  assetSymbol: string;
  /** 基础资产（USDC）地址 —— 申购要 approve 它，UI 不该自己猜地址 */
  asset: `0x${string}`;
  /** 份额代币符号（如 apUSDC） */
  shareSymbol: string;
  /** 份额的小数位（与资产可能不同） */
  shareDecimals: number;
  decimals: number;
  totalAssets: number;
  totalSupply: number;
  /** 1 份额值多少 USDC：直接读 convertToAssets(10**decimals) */
  sharePrice: number;
  cashAsset: number;
  wethAmount: number;
  /** WETH 的 USDC 估值 —— 由 NAV 减现金推出，不额外假设价格 */
  wethValueUsdc: number;
  currentWethBps: number;
  /** 该地址当前可赎回的份额上限；不给地址时为金库整体上限 */
  maxRedeem: number | null;
};

export type VaultSnapshotResult =
  | { ok: true; value: VaultSnapshot }
  | { ok: false; reason: string };

export async function readVaultSnapshot(): Promise<VaultSnapshotResult> {
  const address = vaultAddress();
  if (!address) return { ok: false, reason: "VAULT_ADDRESS 未配置" };

  const client = client_();
  try {
    const blockNumber = await client.getBlockNumber();
    const blockTag = { blockNumber };

    const [totalAssetsRaw, totalSupplyRaw, bps, decimals, asset, weth] = await Promise.all([
      client.readContract({ address, abi: vaultSnapshotAbi, functionName: "totalAssets", ...blockTag }),
      client.readContract({ address, abi: vaultSnapshotAbi, functionName: "totalSupply", ...blockTag }),
      client.readContract({ address, abi: vaultSnapshotAbi, functionName: "currentWethBps", ...blockTag }),
      client.readContract({ address, abi: vaultSnapshotAbi, functionName: "decimals", ...blockTag }),
      client.readContract({ address, abi: vaultSnapshotAbi, functionName: "asset", ...blockTag }),
      client.readContract({ address, abi: vaultSnapshotAbi, functionName: "WETH", ...blockTag }),
    ]);

    const oneShare = 10n ** BigInt(decimals);
    const [sharePriceRaw, cashRaw, wethRaw, assetDecimals, symbol, shareSymbolRaw] = await Promise.all([
      client.readContract({
        address,
        abi: vaultSnapshotAbi,
        functionName: "convertToAssets",
        args: [oneShare],
        ...blockTag,
      }),
      client.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [address], ...blockTag }),
      client.readContract({ address: weth, abi: erc20Abi, functionName: "balanceOf", args: [address], ...blockTag }),
      client.readContract({ address: asset, abi: erc20Abi, functionName: "decimals", ...blockTag }),
      client
        .readContract({
          address: asset,
          abi: parseAbi(["function symbol() view returns (string)"]),
          functionName: "symbol",
          ...blockTag,
        })
        .catch(() => "?"),
      client
        .readContract({ address, abi: vaultSnapshotAbi, functionName: "symbol", ...blockTag })
        .catch(() => "SHARE"),
    ]);

    const block = await client.getBlock({ blockNumber });

    const totalAssets = Number(formatUnits(totalAssetsRaw, assetDecimals));
    const cashAsset = Number(formatUnits(cashRaw, assetDecimals));

    return {
      ok: true,
      value: {
        blockNumber,
        blockTimestamp: Number(block.timestamp),
        vault: address,
        assetSymbol: symbol,
        asset,
        shareSymbol: shareSymbolRaw,
        shareDecimals: Number(decimals),
        decimals,
        totalAssets,
        totalSupply: Number(formatUnits(totalSupplyRaw, decimals)),
        sharePrice: Number(formatUnits(sharePriceRaw, assetDecimals)),
        cashAsset,
        wethAmount: Number(formatUnits(wethRaw, 18)),
        // NAV 里已经算过 WETH 估值，所以这一项是"推导"而非独立估值：
        // 它回答「NAV 里有多少来自 WETH」，不引入第二个价格来源。
        wethValueUsdc: totalAssets - cashAsset,
        currentWethBps: Number(bps),
        // maxRedeem 依赖「谁」在赎回，快照阶段不知道钱包地址，先给金库整体上限；
        // UI 连上钱包后可以按地址再读一次覆盖它。
        maxRedeem: null,
      },
    };
  } catch (error) {
    return { ok: false, reason: reasonFrom(error) };
  }
}
