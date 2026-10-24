#!/usr/bin/env bun
/**
 * Static HTTP server for `plans/*.json`.
 *
 * Why this exists: the CRE workflow runs in QuickJS (no fs), so the plan file
 * has to arrive over HTTP for the workflow to hash its raw bytes. This is the
 * demo-stage stand-in for object storage / IPFS (README §9.7) — same bytes, same
 * hash, just served from disk instead of a bucket.
 *
 *   bun run serve:plans                 # plans/ on http://127.0.0.1:8788
 *   PLANS_PORT=9000 bun run serve:plans
 *
 * Endpoints:
 *   GET /latest.json      the newest plan the workflow can actually report
 *   GET /plans.json       debug summary of every plan, and why one was chosen
 *   GET /<planId>.json    one specific plan, by name
 *   GET /health           liveness
 *
 * All plan responses are the file's exact bytes: no JSON re-encoding, no
 * pretty-print, no newline changes. Whatever the workflow fetches is what
 * `cast keccak` sees on disk.
 */
import { keccakOf } from "./canonical.ts";
import { readChainState, readExecutions, ZERO_HASH, type ChainState, type PlanExecution } from "./chain.ts";
import { MAX_PLAN_AGE_SECONDS, planSchema } from "./schema.ts";

const PLAN_FILE = /^[A-Za-z0-9._:@+-]+\.json$/;

export type PlanSummary = {
  file: string;
  planId: string;
  asOf: number;
  validitySeconds: number;
  validUntil: number;
  degraded: boolean;
  targetWethBps: number;
  bytes: number;
  keccak256: `0x${string}`;
  ageSeconds: number;
  /** True when all three `latest` conditions hold at the observed chain time. */
  selectable: boolean;
  /** Human-readable reasons when `selectable` is false. Empty otherwise. */
  rejectedBecause: string[];
  /** Caveats that do not block selection but matter to the operator. */
  notes: string[];
  /** keccak(file) == vault.lastPlan().lastPlanHash — this is the executed plan. */
  onchainMatch: boolean;
  /** The nonce the vault recorded for this plan, or null if it never ran. */
  onchainNonce: number | null;
  /** How many times the vault reported this exact planHash (should be 0 or 1). */
  onchainExecutions: number;
};

export type LatestSelection = {
  chainNow: number;
  chosen?: PlanSummary;
  /**
   * Why `chosen` was chosen. `onchain` means it is the plan the vault last
   * executed; `newest-reportable` means there was nothing onchain to match and
   * the three time/degraded conditions picked a local file.
   */
  reason?: "onchain" | "newest-reportable";
  /** Every plan, newest first, with its own verdict. */
  considered: PlanSummary[];
};

/** What the server knows about the chain; both reads are optional for tests. */
export type ChainContext = {
  state: ChainState;
  executions: PlanExecution[];
};

type RawPlan = {
  file: string;
  bytes: Uint8Array;
  planId: string;
  asOf: number;
  validitySeconds: number;
  degraded: boolean;
  targetWethBps: number;
};

async function readPlans(dir: string): Promise<{ plans: RawPlan[]; errors: string[] }> {
  const errors: string[] = [];
  let names: string[];
  try {
    names = [...new Bun.Glob("*.json").scanSync(dir)].sort();
  } catch {
    return { plans: [], errors: [`plan directory not found: ${dir}`] };
  }

  const plans: RawPlan[] = [];
  for (const name of names) {
    const bytes = new Uint8Array(await Bun.file(`${dir}/${name}`).arrayBuffer());
    try {
      const parsed = planSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
      if (!parsed.success) {
        errors.push(`${name}: schema rejected (${parsed.error.issues[0]?.message ?? "invalid"})`);
        continue;
      }
      const plan = parsed.data;
      if (plan.planId !== name.slice(0, -".json".length)) {
        // A mismatched name is not fatal for serving bytes, but it makes
        // /latest.json ordering and debugging lie, so it is surfaced.
        errors.push(`${name}: planId "${plan.planId}" does not match its filename`);
        continue;
      }
      plans.push({
        file: name,
        bytes,
        planId: plan.planId,
        asOf: plan.asOf,
        validitySeconds: plan.validitySeconds,
        degraded: plan.degraded,
        targetWethBps: plan.final.targetWethBps,
      });
    } catch (error) {
      errors.push(`${name}: unreadable JSON (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  // planId is a zero-padded UTC timestamp, so descending string order is
  // descending time. Sorting by file name would scramble anything non-ISO.
  plans.sort((a, b) => (a.planId < b.planId ? 1 : a.planId > b.planId ? -1 : 0));
  return { plans, errors };
}

/**
 * The three conditions PM ruled on, applied to one plan at a given chain time.
 * They are deliberately strict: a plan that fails any of them cannot be
 * reported, so handing it to the workflow only produces a confusing refusal.
 */
function summarise(plan: RawPlan, chainNow: number, context?: ChainContext): PlanSummary {
  const validUntil = plan.asOf + plan.validitySeconds;
  const ageSeconds = chainNow - plan.asOf;
  const rejectedBecause: string[] = [];
  const notes: string[] = [];

  // 1. degraded plans must never be served as "latest": the workflow refuses
  //    them, so picking one turns a config mistake into a fake bug report.
  if (plan.degraded) rejectedBecause.push("degraded: true (workflow refuses degraded plans)");

  // 2. MAX_PLAN_AGE backstop: the vault would reject it for its whole life.
  if (ageSeconds > MAX_PLAN_AGE_SECONDS) {
    rejectedBecause.push(`older than MAX_PLAN_AGE (${ageSeconds}s > ${MAX_PLAN_AGE_SECONDS}s)`);
  }

  // 3. validUntil is the primary constraint.
  if (validUntil <= chainNow) {
    rejectedBecause.push(`expired (validUntil ${validUntil} <= chain ${chainNow})`);
  }

  // Caveat only: asOf is in the future, which the vault rejects
  // (PlanFromFuture). Not part of PM's three conditions, so it does not
  // deselect — but it is never silent.
  if (ageSeconds < 0) {
    notes.push(`asOf is ${-ageSeconds}s in the future; the vault rejects a future asOf (PlanFromFuture)`);
  }

  const keccak256 = keccakOf(plan.bytes);
  const execution = context?.executions.find(
    (candidate) => candidate.planHash.toLowerCase() === keccak256.toLowerCase(),
  );
  const onchainMatch =
    context !== undefined &&
    context.state.lastPlanHash.toLowerCase() !== ZERO_HASH &&
    context.state.lastPlanHash.toLowerCase() === keccak256.toLowerCase();

  return {
    file: plan.file,
    planId: plan.planId,
    asOf: plan.asOf,
    validitySeconds: plan.validitySeconds,
    validUntil,
    degraded: plan.degraded,
    targetWethBps: plan.targetWethBps,
    bytes: plan.bytes.length,
    keccak256,
    ageSeconds,
    selectable: rejectedBecause.length === 0,
    rejectedBecause,
    notes,
    onchainMatch,
    onchainNonce: execution?.nonce ?? null,
    onchainExecutions: context?.executions.filter((candidate) => candidate.planHash.toLowerCase() === keccak256.toLowerCase()).length ?? 0,
  };
}

/**
 * Newest-first scan; the first plan passing all three conditions wins.
 *
 * Sorting happens here rather than only in readPlans so the rule holds for any
 * caller: planId is a zero-padded UTC timestamp, so descending string order is
 * descending time. Sorting by filename would scramble non-ISO names.
 */
export function pickLatest(plans: RawPlan[], chainNow: number, context?: ChainContext): LatestSelection {
  const ordered = [...plans].sort((a, b) => (a.planId < b.planId ? 1 : a.planId > b.planId ? -1 : 0));
  const considered = ordered.map((plan) => summarise(plan, chainNow, context));

  // Priority 1: the plan the vault actually executed. `plans/` is an evidence
  // directory, not a data feed — the newest *file* and the newest *decision*
  // are different questions, and only the chain can answer the second one.
  // Serving the newest file while the chain points elsewhere makes the
  // frontend's hash badge show a mismatch that is really a bookkeeping error.
  const onchain = considered.find((entry) => entry.onchainMatch);
  if (onchain) return { chainNow, chosen: onchain, reason: "onchain", considered };

  // Priority 2 (empty environment, or the executed file is not in this
  // directory): fall back to the newest file that is actually reportable.
  const reportable = considered.find((entry) => entry.selectable);
  return { chainNow, chosen: reportable, reason: reportable ? "newest-reportable" : undefined, considered };
}

const jsonHeaders = { "content-type": "application/json", "cache-control": "no-store" };
const json = (value: unknown, status = 200) =>
  new Response(`${JSON.stringify(value, null, 2)}\n`, { status, headers: jsonHeaders });

export type HandlerOptions = {
  dir: string;
  /**
   * The chain context: head timestamp plus the vault's own record of its last
   * executed plan. Injectable so tests need no chain; production reads 8545.
   */
  readChain: () => Promise<ChainContext>;
};

/** Build the fetch handler. Exported so tests can drive it without a socket. */
export function makeHandler({ dir, readChain }: HandlerOptions) {
  return async function fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") return new Response("ok\n", { headers: { "content-type": "text/plain" } });

    const { plans, errors } = await readPlans(dir);

    // ---- debug view: why did /latest.json choose what it chose? ----
    if (pathname === "/plans.json") {
      let context: ChainContext;
      try {
        context = await readChain();
      } catch (error) {
        return json(
          {
            error: "chain unavailable — cannot evaluate validity or the onchain record",
            detail: error instanceof Error ? error.message : String(error),
            plans: errors,
          },
          503,
        );
      }

      const selection = pickLatest(plans, context.state.chainNow, context);
      return json({
        chainNow: selection.chainNow,
        latest: selection.chosen?.file ?? null,
        latestReason: selection.reason ?? null,
        onchain: {
          lastPlanHash: context.state.lastPlanHash,
          lastTargetWethBps: context.state.lastTargetWethBps,
          lastNonce: context.state.lastNonce,
          executions: context.executions.length,
        },
        maxPlanAgeSeconds: MAX_PLAN_AGE_SECONDS,
        plans: selection.considered,
        // Which files cannot be the executed plan, and why that is fine.
        unmatchedOnchain: selection.considered.filter((entry) => !entry.onchainMatch).map((entry) => entry.file),
        errors,
      });
    }

    if (pathname === "/latest.json") {
      if (plans.length === 0) {
        return json({ error: "no plan files", detail: errors.length > 0 ? errors : `nothing in ${dir}` }, 404);
      }

      let context: ChainContext;
      try {
        context = await readChain();
      } catch (error) {
        // Fail closed: without the chain clock, "not expired" cannot be
        // established, and without lastPlanHash the executed plan cannot be
        // identified. Guessing with the wall clock would serve a plan the vault
        // rejects, or a local file the chain has never seen.
        return json(
          {
            error: "chain unavailable — cannot evaluate validity or the onchain record",
            detail: error instanceof Error ? error.message : String(error),
          },
          503,
        );
      }

      const now = context.state.chainNow;
      const selection = pickLatest(plans, now, context);
      if (!selection.chosen) {
        return json(
          {
            error: "no plan is currently reportable",
            chainNow: now,
            priority1: "a file whose keccak == vault.lastPlan().lastPlanHash",
            priority2: [
              "degraded === false",
              `age <= MAX_PLAN_AGE (${MAX_PLAN_AGE_SECONDS}s)`,
              "validUntil > chain now",
            ],
            onchainLastPlanHash: context.state.lastPlanHash,
            rejected: selection.considered.map((entry) => ({
              file: entry.file,
              reasons: entry.rejectedBecause,
            })),
            errors,
          },
          404,
        );
      }

      const body = plans.find((plan) => plan.file === selection.chosen!.file)!.bytes;
      return new Response(body, {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          // Debug aid: which plan these bytes are, and its hash.
          "x-plan-file": selection.chosen.file,
          "x-plan-keccak": selection.chosen.keccak256,
        },
      });
    }

    // ---- one specific plan, by name ----
    const name = decodeURIComponent(pathname.replace(/^\/+/, ""));
    if (!PLAN_FILE.test(name) || name.includes("..")) return new Response("not found\n", { status: 404 });

    const file = Bun.file(`${dir}/${name}`);
    if (!(await file.exists())) return new Response("not found\n", { status: 404 });

    return new Response(file, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  };
}

const dir = process.env.PLANS_DIR ?? "plans";
const host = process.env.PLANS_HOST ?? "127.0.0.1";
const port = Number(process.env.PLANS_PORT ?? 8788);

if (import.meta.main) {
  const rpcUrl = process.env.RPC_URL ?? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
  const vault = process.env.VAULT_ADDRESS as `0x${string}` | undefined;
  const deployBlock = process.env.DEPLOY_BLOCK ? Number(process.env.DEPLOY_BLOCK) : undefined;

  if (!vault) {
    // Without the vault there is no lastPlanHash, which is priority 1 — the
    // server would silently degrade to "newest file", the exact behaviour this
    // endpoint exists to stop. Refuse to start rather than mislead.
    console.error("serve:plans: VAULT_ADDRESS is required (used to read lastPlan/planUsed)");
    process.exit(1);
  }

  const readChain = async (): Promise<ChainContext> => {
    const state = await readChainState(vault, rpcUrl);
    const { executions } = await readExecutions(vault, rpcUrl, { deployBlock });
    return { state, executions };
  };

  const server = Bun.serve({ hostname: host, port, fetch: makeHandler({ dir, readChain }) });

  console.log(`serve:plans  ${dir}/  →  http://${host}:${server.port}/`);
  console.log(`  vault ${vault} @ ${rpcUrl}${deployBlock ? ` (from block ${deployBlock})` : ""}`);
  console.log("  /latest.json   the plan the vault last executed; else newest reportable plan");
  console.log("  /plans.json    every plan with onchainMatch / onchainNonce, and why latest was chosen");
  console.log("  /<planId>.json one specific plan");
}
