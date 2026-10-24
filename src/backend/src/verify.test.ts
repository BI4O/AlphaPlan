import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, encodeEventTopics, keccak256 } from "viem";
import { keccakOf, serializePlan } from "./canonical.ts";
import { fixturePlan } from "./fixtures.ts";
import { PLAN_EVENT_ABI, extractPlanEvent, findPlanByHash, reconcile, verify, type ChainPlanEvent } from "./verify.ts";

/** Test-only helpers on Bun APIs; see debate.test.ts for why not node:fs. */
const tmpDir = (): string => {
  const result = Bun.spawnSync(["mktemp", "-d"]);
  if (result.exitCode !== 0) throw new Error(`mktemp failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
};
const join = (...parts: string[]): string => parts.join("/");

const plan = fixturePlan();
const bytes = new TextEncoder().encode(serializePlan(plan));
const planHash = keccakOf(bytes);

const event = (overrides: Partial<ChainPlanEvent> = {}): ChainPlanEvent => ({
  kind: "PlanExecuted",
  reportHash: `0x${"11".repeat(32)}`,
  planHash,
  asOf: plan.asOf,
  validUntil: plan.asOf + plan.validitySeconds,
  targetWethBps: plan.final.targetWethBps,
  actualWethBps: plan.input.vault.wethBps,
  nonce: 1,
  ...overrides,
});

/** Build the log a real receipt would carry, so decoding is exercised for real. */
function executedLog(shape: { planHash: `0x${string}`; asOf: number; validUntil: number }) {
  const topics = encodeEventTopics({
    abi: PLAN_EVENT_ABI,
    eventName: "PlanExecuted",
    args: { reportHash: `0x${"22".repeat(32)}`, planHash: shape.planHash },
  });

  const data = encodeAbiParameters(
    [
      { type: "uint64" },
      { type: "uint64" },
      { type: "uint16" },
      { type: "uint16" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint64" },
    ],
    [BigInt(shape.asOf), BigInt(shape.validUntil), 3200, 2800, 0n, 0n, 1n],
  );

  return {
    address: "0x0000000000000000000000000000000000000001" as `0x${string}`,
    topics,
    data,
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: `0x${"33".repeat(32)}` as `0x${string}`,
    transactionIndex: 0,
    blockHash: `0x${"44".repeat(32)}` as `0x${string}`,
    removed: false,
  };
}

describe("event decoding uses the full signature, not positions", () => {
  test("decodes all nine PlanExecuted fields in order", async () => {
    const decoded = extractPlanEvent({ logs: [executedLog({ planHash, asOf: 100, validUntil: 1000 })] });
    expect(decoded).toBeDefined();
    expect(decoded!.kind).toBe("PlanExecuted");
    expect(decoded!.planHash).toBe(planHash);
    expect(decoded!.asOf).toBe(100);
    expect(decoded!.validUntil).toBe(1000);
    expect(decoded!.targetWethBps).toBe(3200);
    expect(decoded!.actualWethBps).toBe(2800);
    expect(decoded!.nonce).toBe(1);
  });

  test("unrelated logs are ignored, not treated as a plan", async () => {
    const erc20Log = {
      address: "0x0000000000000000000000000000000000000002" as `0x${string}`,
      topics: [keccak256(new TextEncoder().encode("Transfer(address,address,uint256)"))],
      data: "0x",
      blockNumber: 1n,
      logIndex: 1,
      transactionHash: `0x${"33".repeat(32)}` as `0x${string}`,
      transactionIndex: 0,
      blockHash: `0x${"44".repeat(32)}` as `0x${string}`,
      removed: false,
    };
    expect(extractPlanEvent({ logs: [erc20Log, executedLog({ planHash, asOf: 1, validUntil: 2 })] })!.asOf).toBe(1);
    expect(extractPlanEvent({ logs: [erc20Log] })).toBeUndefined();
  });
});

describe("reconcile", () => {
  test("the happy path is exactly one result", async () => {
    expect(reconcile(plan, bytes, event())).toEqual({ ok: true });
  });

  test("a different file is rejected with both hashes", async () => {
    const other = keccakOf(new TextEncoder().encode("{}"));
    const result = reconcile(plan, bytes, event({ planHash: other }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]).toContain(other);
    expect(result.problems[0]).toContain(planHash);
  });

  test("asOf catches a report that pins an old file with a fresh timestamp", async () => {
    const result = reconcile(plan, bytes, event({ asOf: plan.asOf + 60 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join()).toMatch(/asOf mismatch/);
  });

  test("validUntil must equal asOf + validitySeconds", async () => {
    const result = reconcile(plan, bytes, event({ validUntil: plan.asOf + plan.validitySeconds + 1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join()).toMatch(/validUntil mismatch/);
  });
});

const scratchPlans = async (): Promise<string> => {
  const dir = join(tmpDir(), "plans");
  await Bun.write(join(dir, `${plan.planId}.json`), bytes);
  return dir;
};

describe("verify()", () => {
  test("prints the single contract line and exits 0", async () => {
    const planDir = await scratchPlans();
    const outcome = await verify(`0x${"ab".repeat(32)}`, {
      planDir,
      rpcUrl: "http://unused",
      getReceipt: async () => ({ logs: [executedLog({ planHash, asOf: plan.asOf, validUntil: plan.asOf + plan.validitySeconds })] }),
    });
    expect(outcome.code).toBe(0);
    expect(outcome.line).toBe("OK: on-chain plan == debate record");
    expect(outcome.errors).toEqual([]);
  });

  test("a receipt without a plan event fails, and says why", async () => {
    const outcome = await verify(`0x${"ab".repeat(32)}`, {
      planDir: await scratchPlans(),
      rpcUrl: "http://unused",
      getReceipt: async () => ({ logs: [] }),
    });
    expect(outcome.code).not.toBe(0);
    expect(outcome.errors.join()).toMatch(/no PlanExecuted \/ PlanRecorded event/);
  });

  test("an onchain hash with no matching file lists the local hashes", async () => {
    const planDir = await scratchPlans();
    const outcome = await verify(`0x${"ab".repeat(32)}`, {
      planDir,
      rpcUrl: "http://unused",
      getReceipt: async () => ({
        logs: [executedLog({ planHash: keccakOf(new TextEncoder().encode("nope")), asOf: 1, validUntil: 2 })],
      }),
    });
    expect(outcome.code).not.toBe(0);
    expect(outcome.errors.join()).toContain(planHash);
    expect(outcome.errors.join()).toContain(`${plan.planId}.json`);
  });

  test("findPlanByHash matches on raw bytes", async () => {
    const planDir = await scratchPlans();
    const found = await findPlanByHash(planDir, planHash);
    expect(found?.path).toBe(join(planDir, `${plan.planId}.json`));
    expect(keccakOf(found!.bytes)).toBe(planHash);
    expect(await findPlanByHash(planDir, keccakOf(new TextEncoder().encode("x")))).toBeUndefined();
  });
});
