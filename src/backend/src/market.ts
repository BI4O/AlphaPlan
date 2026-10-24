import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";
import type { MarketInput } from "./schema.ts";

/**
 * Authoritative inputs only (PRD §7.1): Chainlink Data Feeds on Base Sepolia,
 * plus the vault's own view calls. No news source, no price API — the demo must
 * not depend on a service that can 404 while a judge is watching.
 *
 * The addresses below are the ones actually checked onchain (PRD §10). They are
 * repeated on purpose: a price feed address is not something to discover at
 * runtime from a config file.
 */
export const ETH_USD_FEED = "0xa24A68DD788e1D7eb4CA517765CFb2b7e217e7a3" as const;
export const BTC_USD_FEED = "0x961AD289351459A45fC90884eF3AB0278ea95DDE" as const;
export const FEED_DECIMALS = 8;

/**
 * ACCEPTANCE trap 1: the ETH/USD feed was measured 956s (≈16 min) stale, so any
 * threshold at or below 15 min reverts on the spot. 1h it is — the same value
 * the vault uses for its own freshness check.
 */
export const FEED_MAX_STALENESS_SECONDS = 3600;

/** "24h ago" = an onchain round whose timestamp is within ±2h of now - 24h. */
const DAY = 86_400;
const DAY_TOLERANCE = 2 * 3600;
/** How far back to search for that round within the current phase. */
const ROUND_SEARCH_WINDOW = 5000n;
/** Rough cadence used only for the first probe; correctness does not depend on it. */
const FEED_CADENCE_SECONDS = 960;

const HISTORY_FILE = "market-history.json";
const HISTORY_KEEP_SECONDS = 50 * 3600;

const aggregatorV3Abi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 _roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

const vaultAbi = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function currentWethBps() view returns (uint16)",
]);

export type MarketSnapshot = {
  input: MarketInput;
  /**
   * The chain's own clock at read time (block.timestamp), which is the only
   * correct "now" here. On a fork without automine the head block's timestamp
   * freezes between transactions and drifts behind the wall clock by hundreds
   * of seconds, so Date.now() would make every fresh plan look like it came
   * from the future.
   */
  chainNow: number;
  degraded: boolean;
  /** Why this run is degraded, in the operator's words. Surfaced on stderr. */
  notes: string[];
};

export type MarketOptions = {
  rpcUrl?: string;
  vaultAddress?: `0x${string}`;
  /** Directory for the fallback price cache; "" disables it. */
  cacheDir?: string;
  /** Test seam / explicit override: pin "now" instead of reading the head block. */
  now?: number;
  /** Test seam: returns the latest feed price in whole USD. */
  readFeed?: (address: `0x${string}`, label: string) => Promise<number>;
};

const DEFAULT_RPC = process.env.RPC_URL ?? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

const client = (rpcUrl: string) => createPublicClient({ chain: baseSepolia, transport: http(rpcUrl, { timeout: 15_000 }) });

type Round = { roundId: bigint; price: number; updatedAt: number };

function assertRoundUsable(label: string, round: Round, roundId: bigint, answeredInRound: bigint, now: number): void {
  if (round.roundId === 0n) throw new Error(`${label}: feed has no rounds`);
  if (answeredInRound < roundId) throw new Error(`${label}: answeredInRound < roundId (stale round)`);
  if (round.price <= 0) throw new Error(`${label}: non-positive answer for round ${roundId}`);
  if (round.updatedAt === 0) throw new Error(`${label}: round ${roundId} never updated`);
  const age = now - round.updatedAt;
  if (age > FEED_MAX_STALENESS_SECONDS) {
    throw new Error(`${label}: round ${roundId} is ${age}s old (limit ${FEED_MAX_STALENESS_SECONDS}s)`);
  }
}

/** Latest round, with the checks the PRD requires before trusting a price. */
async function readLatestRound(rpcUrl: string, address: `0x${string}`, label: string, now: number): Promise<Round> {
  const [roundId, answer, , updatedAt, answeredInRound] = await client(rpcUrl).readContract({
    address,
    abi: aggregatorV3Abi,
    functionName: "latestRoundData",
  });

  const round = { roundId, price: Number(answer) / 10 ** FEED_DECIMALS, updatedAt: Number(updatedAt) };
  assertRoundUsable(label, round, roundId, answeredInRound, now);
  return round;
}

/** One historical round, or undefined when the aggregator has pruned it. */
async function readRound(
  rpcUrl: string,
  address: `0x${string}`,
  label: string,
  roundId: bigint,
): Promise<Round | undefined> {
  try {
    const [id, answer, , updatedAt, answeredInRound] = await client(rpcUrl).readContract({
      address,
      abi: aggregatorV3Abi,
      functionName: "getRoundData",
      args: [roundId],
    });
    if (answeredInRound < id || answer <= 0n || updatedAt === 0n) return undefined;
    return { roundId: id, price: Number(answer) / 10 ** FEED_DECIMALS, updatedAt: Number(updatedAt) };
  } catch {
    // Pruned or nonexistent round: the aggregator reverts. That is information,
    // not a failure — the caller falls back to the cache.
    void label;
    return undefined;
  }
}

/**
 * Find the round closest to 24h ago by binary search over round ids inside the
 * current phase window. Round ids increase with time, so this is ~13 reads
 * instead of walking ~90 rounds back.
 *
 * Reading the feed's own history is better than only using our cache: it works
 * on the very first run, and the number is the same one anyone can re-read
 * onchain afterwards.
 */
export async function findRound24hAgo(
  rpcUrl: string,
  address: `0x${string}`,
  label: string,
  now: number,
  latest: Round,
): Promise<Round | undefined> {
  const target = now - DAY;

  let lo = latest.roundId > ROUND_SEARCH_WINDOW ? latest.roundId - ROUND_SEARCH_WINDOW : 1n;
  let hi = latest.roundId - 1n; // the latest round is "now", not "24h ago"
  let candidate: Round | undefined;

  // First probe near the expected position; halves the search on the happy path.
  const guess = latest.roundId - BigInt(Math.max(1, Math.round(DAY / FEED_CADENCE_SECONDS)));
  if (guess > lo && guess < hi) {
    const round = await readRound(rpcUrl, address, label, guess);
    if (round && round.updatedAt <= target) {
      candidate = round;
      lo = guess;
    } else if (round) {
      hi = guess - 1n;
    }
  }

  while (lo <= hi) {
    const mid = (lo + hi) / 2n;
    const round = await readRound(rpcUrl, address, label, mid);
    if (!round) break; // older rounds are pruned; nothing further back to read
    if (round.updatedAt <= target) {
      candidate = round;
      lo = mid + 1n;
    } else {
      hi = mid - 1n;
    }
  }

  if (!candidate) return undefined;
  return Math.abs(candidate.updatedAt - target) <= DAY_TOLERANCE ? candidate : undefined;
}

type Sample = { at: number; ethUsd: number; btcUsd: number };
type History = { version: 1; samples: Sample[] };

async function readHistory(cacheDir: string): Promise<History> {
  const file = Bun.file(`${cacheDir}/${HISTORY_FILE}`);
  if (!(await file.exists())) return { version: 1, samples: [] };
  try {
    const parsed = JSON.parse(await file.text()) as History;
    if (parsed.version !== 1 || !Array.isArray(parsed.samples)) return { version: 1, samples: [] };
    return {
      version: 1,
      samples: parsed.samples.filter(
        (s) => Number.isFinite(s.at) && Number.isFinite(s.ethUsd) && Number.isFinite(s.btcUsd),
      ),
    };
  } catch {
    return { version: 1, samples: [] };
  }
}

/** Fallback when the feed's own history cannot be read: our cached observation. */
export function pickCached24hAgo(samples: Sample[], now: number): Sample | undefined {
  const target = now - DAY;
  let best: Sample | undefined;
  for (const sample of samples) {
    if (sample.at >= now - 20 * 3600) continue; // too recent to be "24h ago"
    if (Math.abs(sample.at - target) > DAY_TOLERANCE) continue;
    if (!best || Math.abs(sample.at - target) < Math.abs(best.at - target)) best = sample;
  }
  return best;
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;
const round2 = (x: number) => Math.round(x * 100) / 100;

export function pctChange(from: number | undefined, to: number): number | undefined {
  if (from === undefined || !Number.isFinite(from) || from <= 0) return undefined;
  return round4(((to - from) / from) * 100);
}

/**
 * Head-block timestamp. The single time source for the backend: feed freshness,
 * the 24h reference point, and the plan's own asOf all have to agree with the
 * chain, because the vault's onReport checks asOf/validUntil against
 * block.timestamp.
 */
export async function readChainTime(rpcUrl = DEFAULT_RPC): Promise<number> {
  const block = await client(rpcUrl).getBlock({ blockTag: "latest" });
  return Number(block.timestamp);
}

export async function readMarket(options: MarketOptions = {}): Promise<MarketSnapshot> {
  const rpcUrl = options.rpcUrl ?? DEFAULT_RPC;
  const now = options.now ?? (await readChainTime(rpcUrl));
  const notes: string[] = [];
  let degraded = false;

  const readFeed =
    options.readFeed ??
    ((address: `0x${string}`, label: string) => readLatestRound(rpcUrl, address, label, now).then((r) => r.price));
  const ethUsd = round2(await readFeed(ETH_USD_FEED, "ETH/USD"));
  const btcUsd = round2(await readFeed(BTC_USD_FEED, "BTC/USD"));

  // ---- vault state ----
  let navUsdc = 0;
  let wethBps = 0;
  if (options.vaultAddress) {
    const vault = client(rpcUrl);
    const [assets, bps] = await Promise.all([
      vault.readContract({ address: options.vaultAddress, abi: vaultAbi, functionName: "totalAssets" }),
      vault.readContract({ address: options.vaultAddress, abi: vaultAbi, functionName: "currentWethBps" }),
    ]);
    navUsdc = round4(Number(assets) / 1e6);
    wethBps = Number(bps);
  } else {
    degraded = true;
    notes.push("vault not configured (VAULT_ADDRESS unset) — navUsdc/wethBps recorded as 0, this plan must not be executed");
  }

  // ---- 24h changes: feed history first, local cache as fallback ----
  let ethUsd24hPct = 0;
  let btcUsd24hPct = 0;

  const cacheDir = options.cacheDir ?? ".cache";
  const history = cacheDir ? await readHistory(cacheDir) : { version: 1, samples: [] as Sample[] };
  const cached = pickCached24hAgo(history.samples, now);

  const onchain24h = async (address: `0x${string}`, label: string): Promise<number | undefined> => {
    if (options.readFeed) return undefined; // injected prices have no history to search
    try {
      const latest = await readLatestRound(rpcUrl, address, label, now);
      const old = await findRound24hAgo(rpcUrl, address, label, now, latest);
      return old ? pctChange(old.price, latest.price) : undefined;
    } catch {
      return undefined;
    }
  };

  const [ethOnchain, btcOnchain] = await Promise.all([onchain24h(ETH_USD_FEED, "ETH/USD"), onchain24h(BTC_USD_FEED, "BTC/USD")]);
  const ethPct = ethOnchain ?? pctChange(cached?.ethUsd, ethUsd);
  const btcPct = btcOnchain ?? pctChange(cached?.btcUsd, btcUsd);

  if (ethPct === undefined || btcPct === undefined) {
    degraded = true;
    notes.push("no 24h reference (feed history unreadable and no cached observation ~24h old) — 24h change recorded as 0");
  } else {
    ethUsd24hPct = ethPct;
    btcUsd24hPct = btcPct;
  }

  if (cacheDir) {
    const samples = history.samples
      .filter((s) => s.at >= now - HISTORY_KEEP_SECONDS)
      .concat({ at: now, ethUsd, btcUsd })
      .slice(-1000);
    await Bun.write(`${cacheDir}/${HISTORY_FILE}`, `${JSON.stringify({ version: 1, samples })}\n`);
  }

  return {
    input: { ethUsd, ethUsd24hPct, btcUsd, btcUsd24hPct, vault: { navUsdc, wethBps } },
    chainNow: now,
    degraded,
    notes,
  };
}
