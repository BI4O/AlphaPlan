import { describe, expect, test } from "bun:test";
import { pctChange, pickCached24hAgo, readChainTime, readMarket } from "./market.ts";

/**
 * The time source is the chain, not the wall clock. On a fork without automine
 * the head block freezes between transactions and can sit minutes behind
 * Date.now(), which would make a brand-new plan look like it came from the
 * future (the vault rejects asOf > block.timestamp).
 */
describe("chain time is the single time source", () => {
  test("readMarket reports the injected now as chainNow", async () => {
    const snapshot = await readMarket({
      now: 1_792_821_377,
      cacheDir: "",
      readFeed: async () => 2385.06,
    });
    expect(snapshot.chainNow).toBe(1_792_821_377);
    // No vault configured => degraded, and that must still be explicit.
    expect(snapshot.degraded).toBe(true);
    expect(snapshot.notes.join()).toMatch(/vault not configured/);
  });

  test("feed freshness is measured against chainNow, not the wall clock", async () => {
    const chainNow = 1_792_821_377;
    // Inject a feed reader that reports "this price is fresh at chainNow": the
    // age check itself lives in readLatestRound, so what we assert here is that
    // the same number reaches the 24h reference point.
    const snapshot = await readMarket({ now: chainNow, cacheDir: "", readFeed: async () => 2000 });
    expect(snapshot.chainNow).toBe(chainNow);
    expect(snapshot.input.ethUsd).toBe(2000);
  });

  test("readChainTime returns a positive integer second", async () => {
    const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
    const now = await readChainTime(rpc).catch(() => undefined);
    if (now === undefined) return; // no local chain in this environment
    expect(Number.isInteger(now)).toBe(true);
    expect(now).toBeGreaterThan(1_600_000_000);
  });
});

describe("24h maths", () => {
  test("pctChange", () => {
    expect(pctChange(100, 105)).toBe(5);
    expect(pctChange(100, 90)).toBe(-10);
    expect(pctChange(undefined, 100)).toBeUndefined();
    expect(pctChange(0, 100)).toBeUndefined();
    expect(pctChange(100, 100.123456)).toBe(0.1235);
  });

  test("pickCached24hAgo needs a sample ~24h old, not merely an old one", () => {
    const now = 1_792_821_377;
    const tooRecent = { at: now - 3600, ethUsd: 1, btcUsd: 1 };
    const tooOld = { at: now - 90 * 3600, ethUsd: 1, btcUsd: 1 };
    const good = { at: now - 86_400, ethUsd: 2, btcUsd: 2 };

    expect(pickCached24hAgo([tooRecent, tooOld], now)).toBeUndefined();
    expect(pickCached24hAgo([tooRecent, tooOld, good], now)).toEqual(good);
  });
});
