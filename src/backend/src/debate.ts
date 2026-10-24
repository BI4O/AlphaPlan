#!/usr/bin/env bun
/**
 * AI debate layer (PLAN P2 / PRD §7).
 *
 *   bun run debate                    live: feeds + 3 agents + judge -> plans/<planId>.json
 *   bun run debate --offline          fixed sample, no network, no API key
 *   bun run debate --offline --as-of 1792810800   pin the timestamp (demo)
 *   bun run debate --check            validate every committed plan; non-zero on drift
 *
 * The file it writes is the evidence: its exact bytes are what the CRE workflow
 * hashes and what the chain stores. Nothing here may re-encode a plan before
 * hashing it, and no caller may reformat it afterwards.
 */
import {
  assertRoundTrip,
  checkPlanBytes,
  keccakOf,
  parseLock,
  serializeLock,
  serializePlan,
  sha256Of,
  type PlanLock,
} from "./canonical.ts";
import { LLM_TEMPERATURE, completeJson, errorMessage, llmFromEnv, type LlmConfig } from "./llm.ts";
import { readMarket } from "./market.ts";
import {
  loadPromptTemplates,
  renderAgentUserMessage,
  renderJudgeUserMessage,
  type PromptTemplate,
} from "./prompts.ts";
import {
  AGENTS,
  DEFAULT_VALIDITY_SECONDS,
  MAX_PLAN_AGE_SECONDS,
  OFFLINE_MODEL,
  agentOpinionOutputSchema,
  assertPlanInvariants,
  finalVerdictOutputSchema,
  parsePlan,
  type Agent,
  type AgentOpinion,
  type MarketInput,
  type Plan,
  type PlanProvenance,
} from "./schema.ts";

const DEFAULT_PLAN_DIR = "plans";
const DEFAULT_PROMPTS_DIR = "prompts";
const DEFAULT_OFFLINE_AS_OF = 1_792_810_800; // 2026-10-24T03:00:00Z, the PRD sample

const BPS = (bps: number) => `${(bps / 100).toFixed(1)}%`;

// ---------------------------------------------------------------- utilities

export function isoSeconds(unix: number): string {
  return new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function parseAsOf(raw: string): number {
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error(`--as-of is not a valid unix time: ${raw}`);
    return seconds;
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new Error(`--as-of is neither unix seconds nor an ISO timestamp: ${raw}`);
  return Math.floor(ms / 1000);
}

/** The seal lives beside the plan directory: `plans/` -> `plans.lock.json`. */
export function lockPathFor(planDir: string): string {
  return `${planDir.replace(/\/+$/, "")}.lock.json`;
}

type Mode = "live" | "offline" | "check";

type Args = {
  mode: Mode;
  planDir: string;
  promptsDir: string;
  asOf?: number;
  vault?: `0x${string}`;
  help: boolean;
};

export function parseArgs(argv: string[]): Args {
  const args: Args = { mode: "live", planDir: DEFAULT_PLAN_DIR, promptsDir: DEFAULT_PROMPTS_DIR, help: false };
  const flags = { offline: false, check: false };

  const value = (i: number, name: string): string => {
    const raw = argv[i];
    if (!raw) throw new Error(`${name} needs a value`);
    return raw;
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--offline":
        flags.offline = true;
        break;
      case "--check":
        flags.check = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--dir":
        args.planDir = value(++i, "--dir");
        break;
      case "--prompts":
        args.promptsDir = value(++i, "--prompts");
        break;
      case "--as-of":
        args.asOf = parseAsOf(value(++i, "--as-of"));
        break;
      case "--vault": {
        const raw = value(++i, "--vault");
        if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Error(`--vault needs a 0x address, got ${raw}`);
        args.vault = raw as `0x${string}`;
        break;
      }
      default:
        throw new Error(`unknown argument: ${argv[i]}`);
    }
  }

  if (flags.offline && flags.check) throw new Error("--offline and --check are mutually exclusive");
  args.mode = flags.check ? "check" : flags.offline ? "offline" : "live";
  return args;
}

const USAGE = `usage: bun run debate [--offline | --check] [--dir <plans-dir>] [--prompts <prompts-dir>]
                          [--as-of <unix|ISO>] [--vault <0x…>]

  (no flags)   read Chainlink feeds + vault, run bull/bear/risk + judge, write plans/<planId>.json
  --offline    emit the fixed sample without touching the network (deterministic bytes)
  --check      validate every plan and its hashes; exit 1 on any drift
  --as-of      override the plan timestamp (demo: --offline --as-of "$(date -u +%s)")
  --vault      vault address for input.vault (or set VAULT_ADDRESS)

env:
  DEBATE_LLM_API_KEY / DEBATE_LLM_BASE_URL / DEBATE_LLM_MODEL / DEBATE_LLM_JSON_MODE=0
  RPC_URL / VAULT_ADDRESS / DEBATE_VALIDITY_SECONDS=900
  DEBATE_ALLOW_NONSTANDARD_VALIDITY=1   let --check accept a validitySeconds other than 900`;

export const validitySecondsFromEnv = (env = process.env): number =>
  Number(env.DEBATE_VALIDITY_SECONDS ?? DEFAULT_VALIDITY_SECONDS);

// ------------------------------------------------------------ provenance

const provenance = (template: PromptTemplate, model: string): PlanProvenance => ({
  model,
  promptTemplateSha: template.keccak256,
  temperature: LLM_TEMPERATURE,
});

// ------------------------------------------------------------- offline sample

/**
 * The fixed sample. Same bytes on every run, which is what B6 ("run twice, same
 * sha256") and B4 ("works with the network unplugged") both require.
 *
 * `degraded: true` is the honest label and also the safety boundary: no feed
 * produced these numbers, and the workflow refuses to submit a degraded plan.
 */
export function offlinePlan(asOf: number, prompts: Record<string, PromptTemplate>): Plan {
  const offline = OFFLINE_MODEL;
  const bull = provenance(prompts.bull!, offline);
  const bear = provenance(prompts.bear!, offline);
  const risk = provenance(prompts.risk!, offline);
  const judge = provenance(prompts.judge!, offline);

  return parsePlan({
    planId: isoSeconds(asOf),
    asOf,
    validitySeconds: DEFAULT_VALIDITY_SECONDS,
    degraded: true,
    input: {
      ethUsd: 2385.06,
      ethUsd24hPct: 0,
      btcUsd: 80958.09,
      btcUsd24hPct: 0,
      vault: { navUsdc: 1000, wethBps: 2800 },
    },
    rounds: [
      {
        ...bull,
        agent: "bull",
        targetWethBps: 4500,
        confidence: 0.6,
        reason: "Offline sample: ETH momentum positive, room to add risk inside the 60% cap.",
      },
      {
        ...bear,
        agent: "bear",
        targetWethBps: 1500,
        confidence: 0.55,
        reason: "Offline sample: drawdown risk and thin testnet liquidity argue for cash.",
      },
      {
        ...risk,
        agent: "risk",
        targetWethBps: 3000,
        confidence: 0.7,
        reason: "Offline sample: 30% risk keeps the redemption buffer well above the 40% cash floor.",
      },
    ],
    final: {
      ...judge,
      targetWethBps: 3200,
      confidence: 0.58,
      rationale:
        "Offline sample, no live feed and no LLM: fixed values so the hashing pipeline can be demonstrated with the network down.",
    },
  });
}

// --------------------------------------------------------------- live debate

async function askAgent(
  config: LlmConfig,
  template: PromptTemplate,
  agent: Agent,
  input: MarketInput,
  attempts = 3,
): Promise<AgentOpinion> {
  let feedback = "";
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const raw = await completeJson(config, {
        what: `${agent} opinion`,
        system: template.text,
        user: renderAgentUserMessage(input) + feedback,
      });
      return { ...provenance(template, config.model), agent, ...agentOpinionOutputSchema.parse(raw) };
    } catch (error) {
      lastError = error;
      feedback = `\n\nYour previous reply was rejected: ${errorMessage(error)}. Reply again with only the JSON object.`;
    }
  }
  throw new Error(`${agent} never produced a valid opinion: ${errorMessage(lastError)}`);
}

async function askJudge(
  config: LlmConfig,
  template: PromptTemplate,
  input: MarketInput,
  opinions: AgentOpinion[],
  degraded: boolean,
  notes: string[],
  attempts = 3,
): Promise<Plan["final"]> {
  let feedback = "";
  let lastError: unknown;

  const user = [
    renderJudgeUserMessage(input, opinions),
    ...(degraded ? ["", `This run is degraded: ${notes.join("; ")}`] : []),
  ].join("\n");

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const raw = await completeJson(
        config,
        { what: "judge verdict", system: template.text, user: user + feedback },
        { model: config.judgeModel },
      );
      return { ...provenance(template, config.judgeModel), ...finalVerdictOutputSchema.parse(raw) };
    } catch (error) {
      lastError = error;
      feedback = `\n\nYour previous reply was rejected: ${errorMessage(error)}. Reply again with only the JSON object.`;
    }
  }
  throw new Error(`judge never produced a valid verdict: ${errorMessage(lastError)}`);
}

async function livePlan(args: Args): Promise<Plan> {
  const config = llmFromEnv();
  if (!config) {
    throw new Error(
      "no LLM credentials (DEBATE_LLM_API_KEY unset) — use --offline for the fixed sample, or set the key",
    );
  }

  const prompts = await loadPromptTemplates(args.promptsDir);
  const snapshot = await readMarket({
    vaultAddress: args.vault ?? (process.env.VAULT_ADDRESS as `0x${string}` | undefined),
  });

  for (const note of snapshot.notes) console.error(`degraded: ${note}`);

  console.log(`model   bull/bear/risk = ${config.model}   judge = ${config.judgeModel}   temperature = 0`);

  const opinions = await Promise.all(
    AGENTS.map((agent) => askAgent(config, prompts[agent]!, agent, snapshot.input)),
  );
  const verdict = await askJudge(config, prompts.judge!, snapshot.input, opinions, snapshot.degraded, snapshot.notes);

  const asOf = args.asOf ?? Math.floor(Date.now() / 1000);
  const plan = parsePlan({
    planId: isoSeconds(asOf),
    asOf,
    validitySeconds: validitySecondsFromEnv(),
    degraded: snapshot.degraded,
    input: snapshot.input,
    rounds: opinions,
    final: verdict,
  });

  // Fail before writing, not after: a plan that cannot round-trip can never be
  // verified onchain, and writing it would turn a local bug into "evidence".
  assertPlanInvariants(plan);
  assertRoundTrip(plan, parsePlan);

  console.log(
    `inputs  ETH $${plan.input.ethUsd} (${plan.input.ethUsd24hPct}% 24h)  BTC $${plan.input.btcUsd} (${plan.input.btcUsd24hPct}% 24h)`,
  );
  console.log(
    `vault   NAV ${plan.input.vault.navUsdc} USDC  WETH ${plan.input.vault.wethBps} bps (${BPS(plan.input.vault.wethBps)})`,
  );
  console.log("");
  for (const round of plan.rounds) {
    console.log(
      `${round.agent.padEnd(4)}  ${String(round.targetWethBps).padStart(4)} bps (${BPS(round.targetWethBps).padStart(5)})  ` +
        `conf ${round.confidence.toFixed(2)}  ${round.reason}`,
    );
  }
  console.log(
    `judge  ${String(plan.final.targetWethBps).padStart(4)} bps (${BPS(plan.final.targetWethBps).padStart(5)})  ` +
      `conf ${plan.final.confidence.toFixed(2)}`,
  );
  console.log(`       ${plan.final.rationale}`);
  console.log("");

  return plan;
}

// -------------------------------------------------------------- persistence

async function readLock(lockPath: string): Promise<PlanLock> {
  const file = Bun.file(lockPath);
  if (!(await file.exists())) return { version: 1, plans: {} };
  return parseLock(await file.text());
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

async function persist(plan: Plan, planDir: string): Promise<{ path: string; keccak: `0x${string}`; sha256: string }> {
  // Bun.write creates missing parent directories; no node:fs needed.

  // The bytes written are the bytes hashed. No second serialisation pass.
  const bytes = new TextEncoder().encode(serializePlan(plan));
  const path = `${planDir}/${plan.planId}.json`;

  // `planId` is a second-resolution timestamp, so two runs in the same second
  // can target the same file. Once a plan is evidence, its bytes must never
  // change — a CRE report may already point at them. Identical bytes are a
  // no-op (concurrent duplicate); different bytes are refused, because
  // overwriting would quietly invalidate any onchain planHash for that id.
  const existing = Bun.file(path);
  if (await existing.exists()) {
    const prior = new Uint8Array(await existing.arrayBuffer());
    if (!sameBytes(prior, bytes)) {
      throw new Error(
        `planId collision: ${path} already exists with different bytes (${prior.length} vs ${bytes.length} bytes). ` +
          `Plan files are evidence and are never overwritten — rerun with \`--as-of ${plan.asOf + 1}\` to use the next second.`,
      );
    }
  }

  await Bun.write(path, bytes);

  const lockPath = lockPathFor(planDir);
  const lock = await readLock(lockPath);
  lock.plans[plan.planId] = {
    file: `${plan.planId}.json`,
    bytes: bytes.length,
    sha256: sha256Of(bytes),
    keccak256: keccakOf(bytes),
  };
  await Bun.write(lockPath, serializeLock(lock));

  const entry = lock.plans[plan.planId]!;
  return { path, keccak: entry.keccak256, sha256: entry.sha256 };
}

// -------------------------------------------------------------------- check

export type PlanProblem = { file: string; message: string };

/**
 * Validate every committed plan. A plan file's bytes are the hash, so "it parses
 * and the numbers look fine" is not the bar: the bytes must be exactly what this
 * codebase's writer produces.
 */
export async function checkPlans(planDir: string, promptsDir = DEFAULT_PROMPTS_DIR): Promise<PlanProblem[]> {
  const problems: PlanProblem[] = [];
  const lockPath = lockPathFor(planDir);

  let files: string[];
  try {
    files = [...new Bun.Glob("*.json").scanSync(planDir)].sort();
  } catch {
    return [{ file: planDir, message: "plan directory does not exist" }];
  }

  let prompts: Record<string, PromptTemplate> | undefined;
  try {
    prompts = await loadPromptTemplates(promptsDir);
  } catch (error) {
    problems.push({ file: promptsDir, message: errorMessage(error) });
  }

  let lock: PlanLock = { version: 1, plans: {} };
  const lockFile = Bun.file(lockPath);
  if (await lockFile.exists()) {
    const lockBytes = new Uint8Array(await lockFile.arrayBuffer());
    for (const issue of checkPlanBytes(lockBytes)) problems.push({ file: lockPath, message: issue });
    try {
      const text = new TextDecoder().decode(lockBytes);
      lock = parseLock(text);
      if (serializeLock(lock) !== text) {
        problems.push({ file: lockPath, message: "not in canonical form — regenerate it with bun run debate" });
      }
    } catch (error) {
      problems.push({ file: lockPath, message: `unreadable lock: ${errorMessage(error)}` });
    }
  } else if (files.length > 0) {
    problems.push({ file: lockPath, message: "missing lock file — byte drift cannot be detected" });
  }

  const allowNonstandard = process.env.DEBATE_ALLOW_NONSTANDARD_VALIDITY === "1";
  const seen = new Set<string>();

  for (const name of files) {
    const path = `${planDir}/${name}`;
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const stem = name.slice(0, -".json".length);
    seen.add(stem);

    for (const issue of checkPlanBytes(bytes)) problems.push({ file: path, message: issue });

    let plan: Plan | undefined;
    try {
      plan = parsePlan(JSON.parse(text));
    } catch (error) {
      problems.push({ file: path, message: `schema: ${errorMessage(error)}` });
      continue;
    }

    if (plan.planId !== stem) {
      problems.push({ file: path, message: `planId "${plan.planId}" does not match filename "${name}"` });
    }

    // Constraint: the file must be exactly what serializePlan produces, and the
    // writer must stay in agreement with the parser in both directions.
    const canonical = serializePlan(plan);
    if (canonical !== text) {
      const at = [...canonical].findIndex((ch, i) => ch !== text[i]);
      problems.push({
        file: path,
        message:
          `not byte-canonical: differs from serializePlan output at byte ${at === -1 ? "EOF" : at} — ` +
          `bytes are the hash, so the file is regenerated, never edited`,
      });
    }
    try {
      assertRoundTrip(plan, parsePlan);
    } catch (error) {
      problems.push({ file: path, message: errorMessage(error) });
    }

    // Provenance: the hashes must match the templates in this repository.
    if (prompts) {
      for (const round of plan.rounds) {
        const expected = prompts[round.agent]?.keccak256;
        if (!expected) {
          problems.push({ file: path, message: `no template prompts/${round.agent}.txt` });
        } else if (round.promptTemplateSha.toLowerCase() !== expected.toLowerCase()) {
          problems.push({
            file: path,
            message:
              `${round.agent}.promptTemplateSha ${round.promptTemplateSha} != keccak256(${prompts[round.agent]!.path}) ${expected}`,
          });
        }
      }
      const judgeExpected = prompts.judge?.keccak256;
      if (!judgeExpected) {
        problems.push({ file: path, message: "no template prompts/judge.txt" });
      } else if (plan.final.promptTemplateSha.toLowerCase() !== judgeExpected.toLowerCase()) {
        problems.push({
          file: path,
          message: `final.promptTemplateSha ${plan.final.promptTemplateSha} != keccak256(${prompts.judge!.path}) ${judgeExpected}`,
        });
      }
    }

    // Validity window: validUntil is primary, MAX_PLAN_AGE is the backstop.
    if (plan.validitySeconds > MAX_PLAN_AGE_SECONDS) {
      problems.push({
        file: path,
        message: `validitySeconds ${plan.validitySeconds} > MAX_PLAN_AGE ${MAX_PLAN_AGE_SECONDS} — the vault would reject this plan for its whole life`,
      });
    } else if (plan.validitySeconds !== DEFAULT_VALIDITY_SECONDS && !allowNonstandard) {
      problems.push({
        file: path,
        message:
          `validitySeconds ${plan.validitySeconds} != ${DEFAULT_VALIDITY_SECONDS} (derived from the 600s cron cycle) — ` +
          `set DEBATE_ALLOW_NONSTANDARD_VALIDITY=1 only with a stated reason`,
      });
    }

    // The offline sample must never look like a live decision.
    const models = [...plan.rounds.map((round) => round.model), plan.final.model];
    if (models.includes(OFFLINE_MODEL) && !plan.degraded) {
      problems.push({ file: path, message: `model "${OFFLINE_MODEL}" requires degraded: true` });
    }

    const entry = lock.plans[stem];
    if (!entry) {
      problems.push({ file: path, message: `not recorded in ${lockPath} — run bun run debate to seal it` });
      continue;
    }
    if (entry.file !== name) problems.push({ file: path, message: `lock says file "${entry.file}"` });
    if (entry.bytes !== bytes.length) {
      problems.push({ file: path, message: `size drift: lock ${entry.bytes} bytes, file ${bytes.length}` });
    }
    const sha = sha256Of(bytes);
    if (entry.sha256 !== sha) problems.push({ file: path, message: `sha256 drift: lock ${entry.sha256}, file ${sha}` });
    const keccak = keccakOf(bytes);
    if (entry.keccak256.toLowerCase() !== keccak.toLowerCase()) {
      problems.push({ file: path, message: `keccak256 drift: lock ${entry.keccak256}, file ${keccak}` });
    }
  }

  for (const id of Object.keys(lock.plans)) {
    if (!seen.has(id)) problems.push({ file: lockPath, message: `lists plan "${id}" but ${planDir}/${id}.json is missing` });
  }

  return problems;
}

// --------------------------------------------------------------------- main

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  if (args.mode === "check") {
    const problems = await checkPlans(args.planDir, args.promptsDir);
    const lock = await readLock(lockPathFor(args.planDir));

    if (problems.length > 0) {
      for (const problem of problems) console.error(`FAIL ${problem.file}: ${problem.message}`);
      console.error(`\n${problems.length} problem(s). A plan file's bytes are the hash — they are regenerated, never edited.`);
      return 1;
    }

    const ids = Object.keys(lock.plans).sort();
    for (const id of ids) console.log(`OK ${args.planDir}/${id}.json  keccak=${lock.plans[id]!.keccak256}`);
    console.log(`OK: ${ids.length} plan(s) validated against ${lockPathFor(args.planDir)}`);
    return 0;
  }

  const prompts = await loadPromptTemplates(args.promptsDir);
  const plan = args.mode === "offline" ? offlinePlan(args.asOf ?? DEFAULT_OFFLINE_AS_OF, prompts) : await livePlan(args);

  const written = await persist(plan, args.planDir);
  const size = new TextEncoder().encode(serializePlan(plan)).length;

  console.log(`planId  ${plan.planId}${plan.degraded ? "  [degraded]" : ""}`);
  console.log(`file    ${written.path}  (${size} bytes, validity ${plan.validitySeconds}s)`);
  console.log(`keccak  ${written.keccak}`);
  console.log(`sha256  ${written.sha256}`);
  console.log(
    `        cast keccak 0x$(xxd -p -c 1000000 ${written.path} | tr -d '\\n')`,
  );
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    console.error(`debate: ${errorMessage(error)}`);
    process.exit(1);
  }
}
