import { describe, expect, test } from "bun:test";
import { keccakOf, serializePlan } from "./canonical.ts";
import { ZERO_HASH, type ChainState, type PlanExecution } from "./chain.ts";
import { makeHandler, pickLatest, type ChainContext } from "./serve-plans.ts";
import { DEFAULT_VALIDITY_SECONDS, parsePlan, type Plan } from "./schema.ts";

const SHA = `0x${"ab".repeat(32)}`;

const plan = (over: Partial<{ planId: string; asOf: number; degraded: boolean; targetWethBps: number }> = {}): Plan => {
  const asOf = over.asOf ?? 1_792_823_000;
  return parsePlan({
    planId: over.planId ?? planIdFor(asOf),
    asOf,
    validitySeconds: DEFAULT_VALIDITY_SECONDS,
    degraded: over.degraded ?? false,
    input: {
      ethUsd: 2385.06,
      ethUsd24hPct: 5.26,
      btcUsd: 80857.79,
      btcUsd24hPct: -2.81,
      vault: { navUsdc: 19.99, wethBps: 1496 },
    },
    rounds: [
      { agent: "bull", model: "m", promptTemplateSha: SHA, temperature: 0, targetWethBps: 4200, confidence: 0.6, reason: "up" },
      { agent: "bear", model: "m", promptTemplateSha: SHA, temperature: 0, targetWethBps: 2200, confidence: 0.6, reason: "down" },
      { agent: "risk", model: "m", promptTemplateSha: SHA, temperature: 0, targetWethBps: 1300, confidence: 0.6, reason: "risk" },
    ],
    final: {
      model: "m",
      promptTemplateSha: SHA,
      temperature: 0,
      targetWethBps: over.targetWethBps ?? 1300,
      confidence: 0.62,
      rationale: "trim",
    },
  });
};

function planIdFor(asOf: number): string {
  return `${new Date(asOf * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")}`;
}

const tmpDir = (): string => {
  const result = Bun.spawnSync(["mktemp", "-d"]);
  if (result.exitCode !== 0) throw new Error(`mktemp failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
};

async function publish(plans: Plan[]): Promise<string> {
  const dir = `${tmpDir()}/plans`;
  for (const p of plans) await Bun.write(`${dir}/${p.planId}.json`, new TextEncoder().encode(serializePlan(p)));
  return dir;
}

/** A chain with nothing executed yet: lastPlanHash is zero. */
const emptyChain = (now: number): ChainContext => ({
  state: { lastPlanHash: ZERO_HASH, lastTargetWethBps: 0, lastNonce: 0, chainNow: now },
  executions: [],
});

const handlerFor = (dir: string, now: number, context: ChainContext = emptyChain(now)) =>
  makeHandler({ dir, readChain: async () => context });

const get = (dir: string, now: number, path: string, context?: ChainContext) =>
  handlerFor(dir, now, context)(new Request(`http://127.0.0.1:8788${path}`));

const NOW = 1_792_823_100; // 100s after the base asOf

describe("/latest.json — the three conditions, applied in order", () => {
  test("serves the newest plan that is live, not merely the newest file", async () => {
    const live = plan({ asOf: NOW - 100 });
    const newerButDegraded = plan({ asOf: NOW - 50, degraded: true });
    const dir = await publish([live, newerButDegraded]);

    const response = await get(dir, NOW, "/latest.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-plan-file")).toBe(`${live.planId}.json`);

    // The bytes served are the file's bytes, not a re-encoding.
    const body = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(body)).toBe(serializePlan(live));
    expect(response.headers.get("x-plan-keccak")).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("skips a plan whose validUntil has passed", async () => {
    const expired = plan({ asOf: NOW - DEFAULT_VALIDITY_SECONDS - 10 });
    const live = plan({ asOf: NOW - 100 });
    const dir = await publish([expired, live]);
    expect((await get(dir, NOW, "/latest.json")).headers.get("x-plan-file")).toBe(`${live.planId}.json`);
  });

  test("skips a plan older than MAX_PLAN_AGE even if validUntil somehow still passes", async () => {
    // validitySeconds is 900 here, so craft the age gap directly: asOf 4 hours
    // back is beyond MAX_PLAN_AGE (3600s) and also expired — the rejection list
    // must name both reasons rather than only the first one found.
    const ancient = plan({ asOf: NOW - 4 * 3600 });
    const dir = await publish([ancient]);

    const response = await get(dir, NOW, "/latest.json");
    expect(response.status).toBe(404);
    const payload = (await response.json()) as { rejected: Array<{ reasons: string[] }> };
    const reasons = payload.rejected[0]!.reasons.join(" | ");
    expect(reasons).toMatch(/MAX_PLAN_AGE/);
    expect(reasons).toMatch(/expired/);
  });

  test("404 with reasons when nothing is reportable", async () => {
    const dir = await publish([plan({ asOf: NOW - 5 * 3600, degraded: true })]);
    const response = await get(dir, NOW, "/latest.json");

    expect(response.status).toBe(404);
    const payload = (await response.json()) as {
      error: string;
      priority1: string;
      priority2: string[];
      rejected: Array<{ reasons: string[] }>;
    };
    expect(payload.error).toBe("no plan is currently reportable");
    // Both priorities are stated, in order: the chain's plan first, then the
    // local time/degraded conditions.
    expect(payload.priority1).toMatch(/lastPlan/);
    expect(payload.priority2).toEqual([
      "degraded === false",
      "age <= MAX_PLAN_AGE (3600s)",
      "validUntil > chain now",
    ]);
    expect(payload.rejected[0]!.reasons.join()).toMatch(/degraded: true/);
  });

  test("404 when the directory has no plans", async () => {
    const response = await get(`${tmpDir()}/plans`, NOW, "/latest.json");
    expect(response.status).toBe(404);
  });

  test("503 rather than guessing when the chain clock is unavailable", async () => {
    const dir = await publish([plan({ asOf: NOW - 100 })]);
    const handler = makeHandler({
      dir,
      readChain: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:8545");
      },
    });
    const response = await handler(new Request("http://127.0.0.1:8788/latest.json"));
    expect(response.status).toBe(503);
    const payload = (await response.json()) as { error: string; detail: string };
    expect(payload.error).toMatch(/chain unavailable/);
    expect(payload.detail).toMatch(/ECONNREFUSED/);
  });

  test("a future asOf is served but flagged, not silently accepted", async () => {
    const future = plan({ asOf: NOW + 300 });
    const dir = await publish([future]);
    expect((await get(dir, NOW, "/latest.json")).headers.get("x-plan-file")).toBe(`${future.planId}.json`);

    const debug = (await (await get(dir, NOW, "/plans.json")).json()) as {
      plans: Array<{ notes: string[]; selectable: boolean }>;
    };
    expect(debug.plans[0]!.notes.join()).toMatch(/in the future.*PlanFromFuture/);
  });
});

describe("/plans.json — the debug view", () => {
  test("lists every plan newest-first with hashes and a selection verdict", async () => {
    const older = plan({ asOf: NOW - 200 });
    const newer = plan({ asOf: NOW - 60, degraded: true });
    const dir = await publish([older, newer]);

    const payload = (await (await get(dir, NOW, "/plans.json")).json()) as {
      chainNow: number;
      latest: string;
      plans: Array<{ file: string; selectable: boolean; keccak256: string; rejectedBecause: string[] }>;
    };

    expect(payload.chainNow).toBe(NOW);
    expect(payload.latest).toBe(`${older.planId}.json`);
    expect(payload.plans.map((p) => p.file)).toEqual([`${newer.planId}.json`, `${older.planId}.json`]);
    expect(payload.plans[0]!.selectable).toBe(false);
    expect(payload.plans[1]!.selectable).toBe(true);
    for (const entry of payload.plans) expect(entry.keccak256).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("specific files still work", () => {
  test("/<planId>.json returns one named plan", async () => {
    const target = plan({ asOf: NOW - 100 });
    const dir = await publish([target, plan({ asOf: NOW - 200 })]);
    const response = await get(dir, NOW, `/${target.planId}.json`);
    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()))).toBe(serializePlan(target));
  });

  test("traversal and non-plan paths are refused", async () => {
    const dir = await publish([plan({ asOf: NOW - 100 })]);
    for (const path of ["/../package.json", "/package.json", "/latest.json.bak", "/.env"]) {
      const response = await get(dir, NOW, path);
      expect([403, 404]).toContain(response.status);
    }
  });

  test("/health", async () => {
    const dir = await publish([]);
    expect(await (await get(dir, NOW, "/health")).text()).toBe("ok\n");
  });
});

describe("pickLatest ordering", () => {
  test("newest-first by planId, independent of file listing order", () => {
    const raw = [
      { file: "a.json", bytes: new Uint8Array(), planId: "2026-10-24T03:00:00Z", asOf: 1, validitySeconds: 900, degraded: true, targetWethBps: 1 },
      { file: "b.json", bytes: new Uint8Array(), planId: "2026-10-24T06:25:34Z", asOf: 1, validitySeconds: 900, degraded: true, targetWethBps: 1 },
    ];
    const selection = pickLatest(raw, 1_000_000);
    expect(selection.considered.map((p) => p.planId)).toEqual(["2026-10-24T06:25:34Z", "2026-10-24T03:00:00Z"]);
  });
});

// ---------------------------------------------------------------- priority 1

/** A chain that has executed `plan` at `nonce`. */
const executedChain = (now: number, plan: Plan, nonce: number): ChainContext => ({
  state: { lastPlanHash: keccakOf(new TextEncoder().encode(serializePlan(plan))), lastTargetWethBps: plan.final.targetWethBps, lastNonce: nonce, chainNow: now },
  executions: [
    {
      kind: "PlanRecorded",
      planHash: keccakOf(new TextEncoder().encode(serializePlan(plan))),
      asOf: plan.asOf,
      validUntil: plan.asOf + plan.validitySeconds,
      targetWethBps: plan.final.targetWethBps,
      actualWethBps: 0,
      nonce,
      txHash: `0x${"ab".repeat(32)}`,
    },
  ],
});

describe("priority 1: the plan the vault actually executed wins", () => {
  test("an older executed plan is served over a newer local file", async () => {
    // This is the bug PM reported: plans/ is an evidence directory, so the
    // newest FILE is not the newest DECISION. Serving the newer file makes the
    // frontend badge read "hash mismatch" when nothing is actually wrong.
    const executed = plan({ asOf: NOW - 800, targetWethBps: 1000 });
    const newerLocal = plan({ asOf: NOW - 60, targetWethBps: 0 });
    const dir = await publish([executed, newerLocal]);

    const response = await get(dir, NOW, "/latest.json", executedChain(NOW, executed, 1));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-plan-file")).toBe(`${executed.planId}.json`);
    // The bytes are the executed plan's bytes, not the newer file's.
    const body = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(body)).toBe(serializePlan(executed));
  });

  test("an executed plan is served even when it is degraded or expired (it is history)", async () => {
    // The executed file must always be identifiable — that is what auditability
    // means. It is not being proposed for execution here, it is being reported.
    const executed = plan({ asOf: NOW - 5 * 3600, degraded: true });
    const dir = await publish([executed]);
    const response = await get(dir, NOW, "/latest.json", executedChain(NOW, executed, 3));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-plan-file")).toBe(`${executed.planId}.json`);
  });

  test("/plans.json marks which file is onchain, with its nonce", async () => {
    const executed = plan({ asOf: NOW - 500 });
    const local = plan({ asOf: NOW - 100 });
    const dir = await publish([executed, local]);

    const payload = (await (await get(dir, NOW, "/plans.json", executedChain(NOW, executed, 1))).json()) as {
      latest: string;
      latestReason: string;
      onchain: { lastPlanHash: string; lastNonce: number };
      plans: Array<{ file: string; onchainMatch: boolean; onchainNonce: number | null; onchainExecutions: number }>;
      unmatchedOnchain: string[];
    };

    expect(payload.latest).toBe(`${executed.planId}.json`);
    expect(payload.latestReason).toBe("onchain");
    expect(payload.onchain.lastNonce).toBe(1);

    const byFile = new Map(payload.plans.map((p) => [p.file, p]));
    expect(byFile.get(`${executed.planId}.json`)!.onchainMatch).toBe(true);
    expect(byFile.get(`${executed.planId}.json`)!.onchainNonce).toBe(1);
    expect(byFile.get(`${executed.planId}.json`)!.onchainExecutions).toBe(1);

    expect(byFile.get(`${local.planId}.json`)!.onchainMatch).toBe(false);
    expect(byFile.get(`${local.planId}.json`)!.onchainNonce).toBeNull();
    expect(byFile.get(`${local.planId}.json`)!.onchainExecutions).toBe(0);

    expect(payload.unmatchedOnchain).toEqual([`${local.planId}.json`]);
  });

  test("falls back to newest-reportable when the executed file is absent", async () => {
    const executed = plan({ asOf: NOW - 800 });
    const local = plan({ asOf: NOW - 100 });
    const dir = await publish([local]); // executed file deliberately not on disk

    const response = await get(dir, NOW, "/latest.json", executedChain(NOW, executed, 1));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-plan-file")).toBe(`${local.planId}.json`);

    const payload = (await (await get(dir, NOW, "/plans.json", executedChain(NOW, executed, 1))).json()) as {
      latestReason: string;
    };
    expect(payload.latestReason).toBe("newest-reportable");
  });

  test("a zero lastPlanHash means nothing executed yet, so local selection applies", async () => {
    const local = plan({ asOf: NOW - 100 });
    const dir = await publish([local]);
    const payload = (await (await get(dir, NOW, "/plans.json", emptyChain(NOW))).json()) as { latestReason: string };
    expect(payload.latestReason).toBe("newest-reportable");
  });
});
