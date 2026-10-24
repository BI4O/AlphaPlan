import { describe, expect, test } from "bun:test";
import {
  AGENTS,
  DEFAULT_VALIDITY_SECONDS,
  MAX_PLAN_AGE_SECONDS,
  MAX_TARGET_WETH_BPS,
  assertPlanInvariants,
  parsePlan,
  planSchema,
  type Plan,
} from "./schema.ts";

const SHA = `0x${"ab".repeat(32)}`;

const opinion = (agent: string, targetWethBps: number) => ({
  agent,
  model: "test-model",
  promptTemplateSha: SHA,
  temperature: 0,
  targetWethBps,
  confidence: 0.6,
  reason: "because",
});

const final = (targetWethBps: number) => ({
  model: "test-model",
  promptTemplateSha: SHA,
  temperature: 0,
  targetWethBps,
  confidence: 0.6,
  rationale: "because",
});

const fixture = (overrides: Record<string, unknown> = {}): unknown => ({
  planId: "2026-10-24T03:00:00Z",
  asOf: 1_792_810_800,
  validitySeconds: DEFAULT_VALIDITY_SECONDS,
  degraded: false,
  input: {
    ethUsd: 2385.06,
    ethUsd24hPct: -1.2,
    btcUsd: 80958.09,
    btcUsd24hPct: 0.4,
    vault: { navUsdc: 1000, wethBps: 2800 },
  },
  rounds: [opinion("bull", 4500), opinion("bear", 1500), opinion("risk", 3000)],
  final: final(3200),
  ...overrides,
});

const withVerdict = (targetWethBps: unknown) => fixture({ final: final(targetWethBps as number) });
const withObserved = (wethBps: unknown) =>
  fixture({
    input: {
      ethUsd: 2385.06,
      ethUsd24hPct: -1.2,
      btcUsd: 80958.09,
      btcUsd24hPct: 0.4,
      vault: { navUsdc: 1000, wethBps },
    },
  });

describe("B5 — targetWethBps is a decision, bounded by the mandate", () => {
  for (const bad of [-1, 6001, 10_000, 3.5]) {
    test(`final.targetWethBps=${bad} is rejected`, () => {
      expect(() => parsePlan(withVerdict(bad))).toThrow();
    });
  }

  for (const good of [0, MAX_TARGET_WETH_BPS]) {
    test(`final.targetWethBps=${good} is accepted`, () => {
      expect(parsePlan(withVerdict(good)).final.targetWethBps).toBe(good);
    });
  }

  for (const bad of [-1, 6001, 3.5]) {
    test(`rounds[0].targetWethBps=${bad} is rejected`, () => {
      const rounds = [opinion("bull", bad as number), opinion("bear", 1500), opinion("risk", 3000)];
      expect(() => parsePlan(fixture({ rounds }))).toThrow();
    });
  }
});

describe("observed vault weighting is a measurement, not a decision", () => {
  test("6001 and 10000 are accepted (ETH can rally past 60% with no trade)", () => {
    expect(parsePlan(withObserved(6001)).input.vault.wethBps).toBe(6001);
    expect(parsePlan(withObserved(10_000)).input.vault.wethBps).toBe(10_000);
  });

  test("10001 is rejected", () => {
    expect(() => parsePlan(withObserved(10_001))).toThrow();
  });
});

describe("B9 — model provenance is required and pinned", () => {
  test("temperature must be exactly 0", () => {
    expect(() => parsePlan(fixture({ final: { ...final(3200), temperature: 0.7 } }))).toThrow(/temperature/);
  });

  test("a missing model field is rejected", () => {
    const { model: _model, ...noModel } = final(3200);
    expect(() => parsePlan(fixture({ final: noModel }))).toThrow(/model/);
  });

  test("a missing promptTemplateSha field is rejected", () => {
    const { promptTemplateSha: _sha, ...noSha } = final(3200);
    expect(() => parsePlan(fixture({ final: noSha }))).toThrow(/promptTemplateSha/);
  });

  test("a non-hex promptTemplateSha is rejected", () => {
    expect(() => parsePlan(fixture({ final: { ...final(3200), promptTemplateSha: "bull.txt" } }))).toThrow(
      /promptTemplateSha/,
    );
  });

  test("every opinion carries provenance too", () => {
    const rounds = planSchema.parse(fixture()).rounds;
    for (const round of rounds) {
      expect(round.model).toBe("test-model");
      expect(round.promptTemplateSha).toBe(SHA);
      expect(round.temperature).toBe(0);
    }
  });
});

describe("degraded is required — no default", () => {
  test("omitting degraded is rejected", () => {
    const { degraded: _degraded, ...rest } = fixture() as Record<string, unknown>;
    expect(() => parsePlan(rest)).toThrow(/degraded/);
  });

  test("explicit false is accepted (live runs say so)", () => {
    expect(parsePlan(fixture({ degraded: false })).degraded).toBe(false);
  });
});

describe("rounds must be one opinion per agent, in order", () => {
  test("three bulls are rejected", () => {
    const rounds = [opinion("bull", 4500), opinion("bull", 4600), opinion("bull", 4700)];
    expect(() => parsePlan(fixture({ rounds }))).toThrow(/rounds\[1\]\.agent/);
  });

  test("the canonical order is accepted", () => {
    const rounds = AGENTS.map((agent, i) => opinion(agent, 3000 + i));
    expect(planSchema.parse(fixture({ rounds })).rounds.map((r) => r.agent)).toEqual([...AGENTS]);
  });
});

describe("validity window", () => {
  test("the default is 900s, one cron cycle plus margin", () => {
    expect(DEFAULT_VALIDITY_SECONDS).toBe(900);
  });

  test(`validitySeconds above MAX_PLAN_AGE (${MAX_PLAN_AGE_SECONDS}) is rejected by assertPlanInvariants`, () => {
    const plan = parsePlan(fixture({ validitySeconds: MAX_PLAN_AGE_SECONDS + 1 })) as Plan;
    expect(() => assertPlanInvariants(plan)).toThrow(/MAX_PLAN_AGE/);
  });

  test("the default passes assertPlanInvariants", () => {
    expect(() => assertPlanInvariants(parsePlan(fixture()))).not.toThrow();
  });
});
