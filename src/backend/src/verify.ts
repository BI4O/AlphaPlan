#!/usr/bin/env bun
/**
 * Onchain ↔ plan-file reconciliation (PLAN P4).
 *
 *   bun run verify 0x<txHash>
 *
 * Reads the PlanExecuted / PlanRecorded event from the transaction receipt, takes
 * the planHash it carries, and compares it against keccak256 of the plan file's
 * RAW BYTES. This is the last frame of the demo: one command, one line.
 *
 * It also checks the two fields that only the event can prove — `asOf` and
 * `validUntil` — because planHash alone says "this file", not "this file *now*".
 * The contract cannot see the file; that half of the guarantee lives here and in
 * the frontend badge (PRD §5).
 *
 * Exit 0 and exactly one stdout line on success. Anything else is non-zero and
 * prints both hashes.
 */
import { createPublicClient, http, parseAbiItem, parseEventLogs } from "viem";
import { baseSepolia } from "viem/chains";
import { keccakOf } from "./canonical.ts";
import { errorMessage } from "./llm.ts";
import { parsePlan, type Plan } from "./schema.ts";

/**
 * The full signatures, never positional decoding by hand. Both events carry the
 * same plan fields; the trade path emits PlanExecuted, the tolerance path emits
 * PlanRecorded (PRD §5 step 8 still consumes a nonce and still emits).
 */
const PLAN_EXECUTED = parseAbiItem(
  "event PlanExecuted(bytes32 indexed reportHash, bytes32 indexed planHash, uint64 asOf, uint64 validUntil, uint16 targetWethBps, uint16 actualWethBps, uint256 usdcIn, uint256 wethIn, uint64 nonce)",
);
const PLAN_RECORDED = parseAbiItem(
  "event PlanRecorded(bytes32 indexed reportHash, bytes32 indexed planHash, uint64 asOf, uint64 validUntil, uint16 targetWethBps, uint16 actualWethBps, uint64 nonce)",
);
export const PLAN_EVENT_ABI = [PLAN_EXECUTED, PLAN_RECORDED] as const;

export type ChainPlanEvent = {
  kind: "PlanExecuted" | "PlanRecorded";
  reportHash: `0x${string}`;
  planHash: `0x${string}`;
  asOf: number;
  validUntil: number;
  targetWethBps: number;
  actualWethBps: number;
  nonce: number;
};

export type ReconcileResult = { ok: true } | { ok: false; problems: string[] };

/**
 * Pure comparison between one plan file and one onchain event.
 *
 * `planHash` proves the bytes; `asOf`/`validUntil` prove the timing. A report
 * could carry the hash of a 2020 file with asOf = now (a compromised workflow
 * can do exactly that), so the two checks are not redundant.
 */
export function reconcile(plan: Plan, bytes: Uint8Array, event: ChainPlanEvent): ReconcileResult {
  const problems: string[] = [];

  const localHash = keccakOf(bytes);
  if (localHash.toLowerCase() !== event.planHash.toLowerCase()) {
    problems.push(`planHash mismatch: onchain ${event.planHash}, file ${localHash}`);
  }
  if (plan.asOf !== event.asOf) {
    problems.push(`asOf mismatch: onchain ${event.asOf}, file ${plan.asOf}`);
  }
  const expectedValidUntil = plan.asOf + plan.validitySeconds;
  if (expectedValidUntil !== event.validUntil) {
    problems.push(
      `validUntil mismatch: onchain ${event.validUntil}, file.asOf + validitySeconds = ${expectedValidUntil}`,
    );
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

// ------------------------------------------------------------------- CLI I/O

export type VerifyOptions = {
  planDir: string;
  rpcUrl: string;
  /** Test seam: replace the receipt lookup. */
  getReceipt?: (txHash: `0x${string}`) => Promise<unknown>;
};

export type VerifyOutcome = {
  code: number;
  line?: string;
  errors: string[];
};

export function extractPlanEvent(receipt: { logs: readonly unknown[] }): ChainPlanEvent | undefined {
  const events = parseEventLogs({
    abi: PLAN_EVENT_ABI,
    // Logs come straight from a viem receipt; `strict: false` keeps unrelated
    // ERC20 logs (Approval / Transfer) out of the result instead of throwing.
    logs: receipt.logs as Parameters<typeof parseEventLogs>[0]["logs"],
    strict: false,
  });

  const last = events.at(-1);
  if (!last) return undefined;

  const args = last.args as {
    reportHash: `0x${string}`;
    planHash: `0x${string}`;
    asOf: bigint;
    validUntil: bigint;
    targetWethBps: number;
    actualWethBps: number;
    nonce: bigint;
  };

  return {
    kind: last.eventName as ChainPlanEvent["kind"],
    reportHash: args.reportHash,
    planHash: args.planHash,
    asOf: Number(args.asOf),
    validUntil: Number(args.validUntil),
    targetWethBps: Number(args.targetWethBps),
    actualWethBps: Number(args.actualWethBps),
    nonce: Number(args.nonce),
  };
}

async function readReceipt(rpcUrl: string, txHash: `0x${string}`) {
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl, { timeout: 20_000 }) });
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (!receipt) throw new Error(`transaction not found on chain: ${txHash} (wrong network or not mined yet?)`);
  if (receipt.status !== "success") throw new Error(`transaction reverted: ${txHash}`);
  return receipt;
}

export async function findPlanByHash(
  planDir: string,
  planHash: string,
): Promise<{ path: string; plan: Plan; bytes: Uint8Array } | undefined> {
  let names: string[];
  try {
    names = [...new Bun.Glob("*.json").scanSync(planDir)].sort();
  } catch {
    return undefined;
  }

  for (const name of names) {
    const path = `${planDir}/${name}`;
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    if (keccakOf(bytes).toLowerCase() !== planHash.toLowerCase()) continue;
    return { path, plan: parsePlan(JSON.parse(new TextDecoder().decode(bytes))), bytes };
  }
  return undefined;
}

async function localHashes(planDir: string): Promise<string[]> {
  try {
    const names = [...new Bun.Glob("*.json").scanSync(planDir)].sort();
    const hashes: string[] = [];
    for (const name of names) {
      const bytes = new Uint8Array(await Bun.file(`${planDir}/${name}`).arrayBuffer());
      hashes.push(`${keccakOf(bytes)}  ${planDir}/${name}`);
    }
    return hashes;
  } catch {
    return [];
  }
}

const USAGE = `usage: bun run verify 0x<txHash> [--dir <plans-dir>] [--rpc <url>]

Reads the PlanExecuted / PlanRecorded event from the receipt and compares its
planHash with keccak256 of a plan file's raw bytes. Exit 0 prints exactly:
  OK: on-chain plan == debate record

env: RPC_URL (default https://sepolia.base.org), VAULT_ADDRESS (unused, for parity)`;

export function parseArgs(argv: string[]): { txHash: `0x${string}`; planDir: string; rpcUrl: string; help: boolean } {
  const planDir = "plans";
  const rpcUrl = process.env.RPC_URL ?? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
  const args = { txHash: "" as `0x${string}`, planDir, rpcUrl, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--dir") {
      const value = argv[++i];
      if (!value) throw new Error("--dir needs a value");
      args.planDir = value;
    } else if (arg === "--rpc") {
      const value = argv[++i];
      if (!value) throw new Error("--rpc needs a value");
      args.rpcUrl = value;
    } else if (/^0x[0-9a-fA-F]{64}$/.test(arg)) {
      args.txHash = arg as `0x${string}`;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }

  return args;
}

export async function verify(txHash: `0x${string}`, options: VerifyOptions): Promise<VerifyOutcome> {
  const errors: string[] = [];

  const receipt = options.getReceipt
    ? ((await options.getReceipt(txHash)) as { logs: readonly unknown[] })
    : await readReceipt(options.rpcUrl, txHash);

  const event = extractPlanEvent(receipt);
  if (!event) {
    return {
      code: 1,
      errors: [`no PlanExecuted / PlanRecorded event in ${txHash} — this transaction did not report a plan`],
    };
  }

  const found = await findPlanByHash(options.planDir, event.planHash);
  if (!found) {
    const hashes = await localHashes(options.planDir);
    return {
      code: 1,
      errors: [
        `planHash mismatch: onchain ${event.planHash}`,
        `no file in ${options.planDir}/ hashes to it. Local files:`,
        ...(hashes.length > 0 ? hashes.map((line) => `  ${line}`) : ["  (none)"]),
      ],
    };
  }

  const result = reconcile(found.plan, found.bytes, event);
  if (!result.ok) {
    return {
      code: 1,
      errors: [`${found.path} does not match ${event.kind} (nonce ${event.nonce}):`, ...result.problems.map((p) => `  ${p}`)],
    };
  }

  return { code: 0, line: "OK: on-chain plan == debate record", errors: [] };
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.txHash) {
    console.error(USAGE);
    return 1;
  }

  const outcome = await verify(args.txHash, { planDir: args.planDir, rpcUrl: args.rpcUrl });
  if (outcome.code !== 0) {
    for (const error of outcome.errors) console.error(error);
    return outcome.code;
  }

  console.log(outcome.line);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    console.error(`verify: ${errorMessage(error)}`);
    process.exit(1);
  }
}
