import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { keccakOf, parseLock, serializeLock, serializePlan, sha256Of, type PlanLock } from "./canonical.ts";
import { lockPathFor } from "./debate.ts";
import { parsePlan, type Plan } from "./schema.ts";

const BACKEND = fileURLToPath(new URL("..", import.meta.url));

/**
 * Test-only filesystem helpers, on Bun APIs rather than node:fs. Keeps the
 * shared typecheck gate green (node builtins resolve to `never` under the
 * installed types) and matches the repo rule "prefer Bun.file over node:fs".
 */
const tmpDir = (): string => {
  const result = Bun.spawnSync(["mktemp", "-d"]);
  if (result.exitCode !== 0) throw new Error(`mktemp failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
};
const join = (...parts: string[]): string => parts.join("/");
const readText = (path: string): Promise<string> => Bun.file(path).text();
const readBytes = async (path: string): Promise<Uint8Array> => new Uint8Array(await Bun.file(path).arrayBuffer());
const writeText = (path: string, text: string): Promise<number> => Bun.write(path, text);
const exists = (path: string): Promise<boolean> => Bun.file(path).exists();
const listJson = (dir: string): string[] => [...new Bun.Glob("*.json").scanSync(dir)];
/** Synchronous read for the sync helper below; `cat` keeps it dependency-free. */
const readTextSync = (path: string): string => {
  const result = Bun.spawnSync(["cat", path]);
  if (result.exitCode !== 0) throw new Error(`cannot read ${path}: ${result.stderr.toString()}`);
  return result.stdout.toString();
};

/** Run the real CLI, with no LLM credentials in the environment. */
function debate(args: string[], env: Record<string, string> = {}) {
  const inherited: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) inherited[key] = value;
  }
  // Never let a real key leak into the suite: bun auto-loads .env, and the
  // "no credentials" test must not actually call the provider.
  delete inherited.DEBATE_LLM_API_KEY;
  delete inherited.DEEPSEEK_API_KEY;
  delete inherited.OPENAI_API_KEY;

  const result = Bun.spawnSync({
    cmd: ["bun", "run", "src/debate.ts", ...args],
    cwd: BACKEND,
    env: { ...inherited, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    out: result.stdout.toString(),
    err: result.stderr.toString(),
  };
}

function scratch(): { root: string; planDir: string } {
  const root = tmpDir();
  return { root, planDir: join(root, "plans") };
}

async function writePlan(planDir: string, plan: Plan): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(serializePlan(plan));
  const file = `${plan.planId}.json`;
  await Bun.write(join(planDir, file), bytes);

  const lock: PlanLock = {
    version: 1,
    plans: {
      [plan.planId]: { file, bytes: bytes.length, sha256: sha256Of(bytes), keccak256: keccakOf(bytes) },
    },
  };
  await Bun.write(lockPathFor(planDir), serializeLock(lock));
  return bytes;
}

const onlyPlanFile = (planDir: string): string => {
  const lock = parseLock(readTextSync(lockPathFor(planDir)));
  const ids = Object.keys(lock.plans);
  expect(ids).toHaveLength(1);
  return join(planDir, lock.plans[ids[0]!]!.file);
};

describe("--offline (B4, B6)", () => {
  test("writes a plan and a seal with the network unplugged, exits 0", async () => {
    const { planDir } = scratch();
    const run = debate(["--offline", "--dir", planDir]);
    expect(run.code).toBe(0);

    const plan = parsePlan(JSON.parse(await readText(onlyPlanFile(planDir))));
    expect(plan.degraded).toBe(true);
    expect(plan.validitySeconds).toBe(900);
    expect(plan.rounds.map((round) => round.agent)).toEqual(["bull", "bear", "risk"]);
    for (const round of [plan.rounds[0]!, plan.rounds[1]!, plan.rounds[2]!, plan.final]) {
      expect(round.model).toBe("offline-sample");
      expect(round.temperature).toBe(0);
      expect(round.promptTemplateSha).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  test("running it twice produces identical bytes (fixed sample, fixed writer)", async () => {
    const first = scratch();
    const second = scratch();
    expect(debate(["--offline", "--dir", first.planDir]).code).toBe(0);
    expect(debate(["--offline", "--dir", second.planDir]).code).toBe(0);

    const a = await readBytes(onlyPlanFile(first.planDir));
    const b = await readBytes(onlyPlanFile(second.planDir));
    expect(sha256Of(a)).toBe(sha256Of(b));
    expect(keccakOf(a)).toBe(keccakOf(b));
  });

  test("the printed keccak is the keccak of the bytes on disk", async () => {
    const { planDir } = scratch();
    const run = debate(["--offline", "--dir", planDir]);
    const printed = run.out.match(/keccak\s+(0x[0-9a-f]{64})/)![1]!;
    expect(printed).toBe(keccakOf(await readBytes(onlyPlanFile(planDir))));
  });

  test("--as-of pins planId to that timestamp", async () => {
    const { planDir } = scratch();
    expect(debate(["--offline", "--dir", planDir, "--as-of", "1792814400"]).code).toBe(0);
    expect(onlyPlanFile(planDir).endsWith("2026-10-24T04:00:00Z.json")).toBe(true);
  });
});

describe("--check (B3)", () => {
  test("a clean plan passes and prints one keccak line per plan", async () => {
    const { planDir } = scratch();
    expect(debate(["--offline", "--dir", planDir]).code).toBe(0);
    const run = debate(["--check", "--dir", planDir]);
    expect(run.code).toBe(0);
    expect(run.out).toMatch(/OK plans\/|OK .*\.json\s+keccak=0x[0-9a-f]{64}/);
    expect(run.out).toMatch(/1 plan\(s\) validated/);
  });

  test("an empty directory passes (nothing to drift)", async () => {
    const { planDir } = scratch();
    await Bun.write(join(planDir, ".keep"), "");
    expect(debate(["--check", "--dir", planDir]).code).toBe(0);
  });

  test("a changed byte fails, even when the file still parses and still looks sane", async () => {
    const { planDir } = scratch();
    expect(debate(["--offline", "--dir", planDir]).code).toBe(0);
    const file = onlyPlanFile(planDir);

    const text = await readText(file);
    const tampered = text.replace('"targetWethBps": 3200', '"targetWethBps": 3201');
    expect(tampered).not.toBe(text); // the tamper actually applied
    await writeText(file, tampered);

    const run = debate(["--check", "--dir", planDir]);
    expect(run.code).not.toBe(0);
    expect(run.err).toMatch(/drift|not byte-canonical/);
  });

  test("a whitespace-only edit fails: the bytes are the hash", async () => {
    const { planDir } = scratch();
    expect(debate(["--offline", "--dir", planDir]).code).toBe(0);
    const file = onlyPlanFile(planDir);

    await writeText(file, (await readText(file)).replace('"asOf": ', '"asOf":  '));

    const run = debate(["--check", "--dir", planDir]);
    expect(run.code).not.toBe(0);
    expect(run.err).toMatch(/not byte-canonical/);
  });

  test("stripping the trailing newline fails", async () => {
    const { planDir } = scratch();
    expect(debate(["--offline", "--dir", planDir]).code).toBe(0);
    const file = onlyPlanFile(planDir);
    await writeText(file, (await readText(file)).trimEnd());

    const run = debate(["--check", "--dir", planDir]);
    expect(run.code).not.toBe(0);
    expect(run.err).toMatch(/does not end with a newline/);
  });

  test("an unsealed plan is reported instead of silently trusted", async () => {
    const { planDir } = scratch();
    expect(debate(["--offline", "--dir", planDir]).code).toBe(0);

    // Same file, no lock beside it: --check must refuse to call it verified.
    const sealed = await readBytes(onlyPlanFile(planDir));
    const orphanDir = join(scratch().root, "plans");
    await Bun.write(join(orphanDir, ".keep"), "");
    await Bun.write(join(orphanDir, "2026-10-24T03:00:00Z.json"), sealed);

    const run = debate(["--check", "--dir", orphanDir]);
    expect(run.code).not.toBe(0);
    expect(run.err).toMatch(/missing lock file/);
  });

  test("a plan whose validitySeconds is not 900 fails, unless explicitly allowed", async () => {
    const { planDir } = scratch();
    const offline = debate(["--offline", "--dir", planDir]);
    expect(offline.code).toBe(0);

    const base = parsePlan(JSON.parse(await readText(onlyPlanFile(planDir))));
    await writePlan(planDir, { ...base, validitySeconds: 1200 });

    const rejected = debate(["--check", "--dir", planDir]);
    expect(rejected.code).not.toBe(0);
    expect(rejected.err).toMatch(/validitySeconds 1200 != 900/);

    const allowed = debate(["--check", "--dir", planDir], { DEBATE_ALLOW_NONSTANDARD_VALIDITY: "1" });
    expect(allowed.code).toBe(0);
  });

  test("a plan above MAX_PLAN_AGE fails even with the escape hatch open", async () => {
    const { planDir } = scratch();
    expect(debate(["--offline", "--dir", planDir]).code).toBe(0);
    const base = parsePlan(JSON.parse(await readText(onlyPlanFile(planDir))));
    await writePlan(planDir, { ...base, validitySeconds: 3601 });

    const run = debate(["--check", "--dir", planDir], { DEBATE_ALLOW_NONSTANDARD_VALIDITY: "1" });
    expect(run.code).not.toBe(0);
    expect(run.err).toMatch(/MAX_PLAN_AGE/);
  });

  test("an offline plan relabelled degraded:false is caught", async () => {
    const { planDir } = scratch();
    expect(debate(["--offline", "--dir", planDir]).code).toBe(0);
    const base = parsePlan(JSON.parse(await readText(onlyPlanFile(planDir))));
    await writePlan(planDir, { ...base, degraded: false });

    const run = debate(["--check", "--dir", planDir]);
    expect(run.code).not.toBe(0);
    expect(run.err).toMatch(/offline-sample.*requires degraded: true/);
  });

  test("a prompt hash that no longer matches prompts/*.txt is caught", async () => {
    const { planDir } = scratch();
    expect(debate(["--offline", "--dir", planDir]).code).toBe(0);
    const base = parsePlan(JSON.parse(await readText(onlyPlanFile(planDir))));
    const rounds = base.rounds.map((round, i) =>
      i === 1 ? { ...round, promptTemplateSha: `0x${"0".repeat(64)}` as const } : round,
    );
    await writePlan(planDir, { ...base, rounds });

    const run = debate(["--check", "--dir", planDir]);
    expect(run.code).not.toBe(0);
    expect(run.err).toMatch(/bear\.promptTemplateSha/);
  });
});

describe("live mode without credentials (B2 guard rail)", () => {
  test("fails fast and names --offline instead of hanging on the network", async () => {
    const { planDir } = scratch();
    const run = debate(["--dir", planDir]);
    expect(run.code).not.toBe(0);
    expect(run.err).toMatch(/DEBATE_LLM_API_KEY/);
    expect(run.err).toMatch(/--offline/);
  });
});

describe("CLI contract", () => {
  test("--offline and --check together are refused", async () => {
    const run = debate(["--offline", "--check"]);
    expect(run.code).not.toBe(0);
    expect(run.err).toMatch(/mutually exclusive/);
  });

  test("an unknown flag is refused rather than ignored", async () => {
    const run = debate(["--offline", "--wat"]);
    expect(run.code).not.toBe(0);
    expect(run.err).toMatch(/unknown argument/);
  });

  test("--help exits 0 and documents the three modes", async () => {
    const run = debate(["--help"]);
    expect(run.code).toBe(0);
    expect(run.out).toMatch(/--offline/);
    expect(run.out).toMatch(/--check/);
  });
});

describe("planId collisions (second-resolution timestamps)", () => {
  test("re-running the same second with identical bytes is idempotent, not an error", async () => {
    const { planDir } = scratch();
    const first = debate(["--offline", "--dir", planDir, "--as-of", "1792810800"]);
    expect(first.code).toBe(0);

    const second = debate(["--offline", "--dir", planDir, "--as-of", "1792810800"]);
    expect(second.code).toBe(0);
    expect(second.out).toMatch(/keccak\s+0x[0-9a-f]{64}/);
    expect(debate(["--check", "--dir", planDir]).code).toBe(0);
  });

  test("different bytes under an existing planId are refused, never overwritten", async () => {
    const { planDir } = scratch();
    expect(debate(["--offline", "--dir", planDir, "--as-of", "1792810800"]).code).toBe(0);

    // Someone (or another process) already published a plan under this id.
    const file = onlyPlanFile(planDir);
    const original = await readText(file);
    await writeText(file, original.replace("Offline sample: ETH momentum", "Offline sample: ETH momentum!"));
    const tampered = await readText(file);

    const run = debate(["--offline", "--dir", planDir, "--as-of", "1792810800"]);
    expect(run.code).not.toBe(0);
    expect(run.err).toMatch(/planId collision/);
    expect(run.err).toMatch(/--as-of 1792810801/);
    // The existing file is left exactly as it was: evidence is never rewritten.
    expect(await readText(file)).toBe(tampered);
  });
});

describe("RPC failure is an environment error, not a silent degradation", () => {
  test("an unreachable RPC exits non-zero and writes no plan", async () => {
    const { planDir } = scratch();
    const run = debate(["--dir", planDir], {
      RPC_URL: "http://127.0.0.1:1",
      VAULT_ADDRESS: "0x8f7a1DEFa8B06a8d66ea14a71A2eF2CE4bA1295b",
      DEBATE_LLM_API_KEY: "dummy-key-for-this-test",
    });

    expect(run.code).not.toBe(0);
    // It must not pretend to have produced a degraded plan.
    expect(run.err).not.toMatch(/degraded:/);
    expect(run.out).not.toMatch(/planId/);
    // No plan was written: the directory is absent or empty, never a placeholder.
    if (await exists(planDir)) {
      expect(listJson(planDir)).toEqual([]);
    }
  });
});
