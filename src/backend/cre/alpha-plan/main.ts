import {
  CronCapability,
  EVMClient,
  HTTPClient,
  LATEST_BLOCK_NUMBER,
  Runner,
  TxStatus,
  consensusIdenticalAggregation,
  encodeCallMsg,
  getNetwork,
  handler,
  ok,
  prepareReportRequest,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import {
  bytesToHex,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
  type Address,
} from "viem";
import { z } from "zod";

/**
 * AlphaPlan — cron workflow (PRD §6).
 *
 * Read vault state + feed price → fetch the plan file over HTTP → hash its raw
 * bytes → gate on degraded / planUsed / nonce → encode the 6-field report →
 * write it (production) or log it (local-simulation).
 *
 * Gate order is not cosmetic: degraded MUST come before planUsed. A used plan is
 * a plan that was already written; checking that first would make the degraded
 * branch unreachable for every plan that ever executed, turning a safety check
 * into dead code (PRD §6, step 5).
 */

// ------------------------------------------------------------------ config

/**
 * No `z.string().url()`: QuickJS has no `URL` global, so zod's URL check rejects
 * valid URLs inside the workflow (skill: concepts.md#zod-url-validation).
 */
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed 20-byte address");
const urlSchema = z.string().regex(/^https?:\/\/[^\s]+$/, "expected an http(s) URL");
const cronSchema = z.string().regex(/^(\S+\s+){5}\S+$/, "CRE cron must have exactly six fields");

const sharedConfig = {
  schedule: cronSchema,
  chainSelectorName: z.string().min(1),
  vaultAddress: addressSchema,
  feedAddress: addressSchema,
  planUrl: urlSchema,
  maxWethBps: z.number().int().min(0).max(6000),
  maxPlanAgeSeconds: z.number().int().positive(),
  feedMaxStalenessSeconds: z.number().int().positive(),
  gasLimit: z.string().regex(/^\d+$/),
};

const configSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("local-simulation"), ...sharedConfig }).strict(),
  z.object({ mode: z.literal("production"), ...sharedConfig }).strict(),
]);

export type Config = z.infer<typeof configSchema>;

/** The subset of the plan file the workflow itself needs. Full bytes are hashed. */
const planSchema = z
  .object({
    planId: z.string().min(1),
    asOf: z.number().int().positive(),
    validitySeconds: z.number().int().positive(),
    degraded: z.boolean(),
    final: z.object({ targetWethBps: z.number().int().min(0).max(6000) }).passthrough(),
  })
  .passthrough();

// ------------------------------------------------------------------- ABIs

const vaultAbi = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function currentWethBps() view returns (uint16)",
  "function lastNonce() view returns (uint64)",
  "function planUsed(bytes32 planHash) view returns (bool)",
]);

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

const REPORT_ABI = parseAbiParameters("address vault, uint64 asOf, uint64 validUntil, uint64 nonce, uint16 targetWethBps, bytes32 planHash");

// -------------------------------------------------------------- plan fetch

type PlanObservation = {
  hex: string;
  planId: string;
  asOf: number;
  validitySeconds: number;
  degraded: boolean;
  targetWethBps: number;
};

/**
 * Fetch the plan and return its bytes as hex plus the fields we gate on.
 *
 * Hex, not raw bytes: consensus observations have a size limit and a byte array
 * is a poor consensus value. Two nodes that read different files produce
 * different hex, so identical aggregation fails — which is the desired outcome
 * for a static file (PRD §6: never median two different plans into one).
 */
const fetchPlan = (sender: HTTPSendRequester, url: string): string => {
  const response = sender.sendRequest({ url, method: "GET" }).result();
  if (!ok(response)) throw new Error(`plan fetch failed: HTTP ${response.statusCode}`);

  const body = response.body;
  if (!body || body.length === 0) throw new Error("plan fetch failed: empty body");

  let hex = "";
  for (let i = 0; i < body.length; i++) hex += body[i]!.toString(16).padStart(2, "0");

  const plan = planSchema.parse(JSON.parse(new TextDecoder().decode(body)));
  const observation: PlanObservation = {
    hex,
    planId: plan.planId,
    asOf: plan.asOf,
    validitySeconds: plan.validitySeconds,
    degraded: plan.degraded,
    targetWethBps: plan.final.targetWethBps,
  };
  return JSON.stringify(observation);
};

// ---------------------------------------------------------------- handler

const onCronTrigger = (runtime: Runtime<Config>): string => {
  const config = runtime.config;

  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName });
  if (!network) throw new Error(`unknown chain selector: ${config.chainSelectorName}`);
  const client = new EVMClient(network.chainSelector.selector);
  const vault = config.vaultAddress as Address;

  // LATEST, not FINALIZED: the report's nonce and planUsed gate must reflect
  // current state, and on the anvil fork the finalized block predates the vault
  // deployment (reads there return no code). The vault re-validates everything
  // onchain, so a fresh-but-unfinalized read cannot be trusted into a bad write.
  const call = (to: Address, data: `0x${string}`): `0x${string}` =>
    bytesToHex(
      client.callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to, data }),
        blockNumber: LATEST_BLOCK_NUMBER,
      }).result().data,
    );

  // ---- 1. plan file (HTTP, identical consensus) ----
  const observed = JSON.parse(
    new HTTPClient()
      .sendRequest(runtime, fetchPlan, consensusIdenticalAggregation<string>())(config.planUrl)
      .result(),
  ) as PlanObservation;

  const planHash = keccak256(`0x${observed.hex}` as `0x${string}`);
  runtime.log(`plan ${observed.planId} → planHash ${planHash} (${observed.hex.length / 2} bytes)`);

  // ---- 2. vault state ----
  const nav = decodeFunctionResult({
    abi: vaultAbi,
    functionName: "totalAssets",
    data: call(vault, encodeFunctionData({ abi: vaultAbi, functionName: "totalAssets" })),
  });
  const currentWethBps = Number(
    decodeFunctionResult({
      abi: vaultAbi,
      functionName: "currentWethBps",
      data: call(vault, encodeFunctionData({ abi: vaultAbi, functionName: "currentWethBps" })),
    }),
  );
  const lastNonce = decodeFunctionResult({
    abi: vaultAbi,
    functionName: "lastNonce",
    data: call(vault, encodeFunctionData({ abi: vaultAbi, functionName: "lastNonce" })),
  });
  runtime.log(`vault nav=${nav} currentWethBps=${currentWethBps} lastNonce=${lastNonce}`);

  // ---- 3. feed freshness ----
  const [roundId, answer, , updatedAt, answeredInRound] = decodeFunctionResult({
    abi: feedAbi,
    functionName: "latestRoundData",
    data: call(config.feedAddress as Address, encodeFunctionData({ abi: feedAbi, functionName: "latestRoundData" })),
  });
  const now = BigInt(Math.floor(runtime.now().getTime() / 1000));
  if (roundId === 0n) throw new Error("feed has no rounds");
  if (answeredInRound < roundId) throw new Error(`feed round ${roundId} not answered`);
  if (answer <= 0n) throw new Error(`feed answer is not positive: ${answer}`);
  if (now - updatedAt > BigInt(config.feedMaxStalenessSeconds)) {
    throw new Error(`feed is ${now - updatedAt}s old (limit ${config.feedMaxStalenessSeconds}s)`);
  }

  const driftBps = observed.targetWethBps - currentWethBps;
  const base = {
    mode: config.mode,
    planId: observed.planId,
    planHash,
    currentWethBps,
    targetWethBps: observed.targetWethBps,
    driftBps,
    nav: nav.toString(),
  };

  // ---- gate 1: degraded. FIRST, always. ----
  // A degraded plan has no live basis; it must never become an onchain record,
  // and the local-simulation path runs the same gate so both logs agree.
  if (observed.degraded) {
    runtime.log("degraded plan, refusing to write");
    return JSON.stringify({ ...base, wouldWrite: false, reason: "degraded plan" });
  }

  // ---- gate 2: planUsed ----
  const used = decodeFunctionResult({
    abi: vaultAbi,
    functionName: "planUsed",
    data: call(vault, encodeFunctionData({ abi: vaultAbi, functionName: "planUsed", args: [planHash] })),
  });
  if (used) {
    runtime.log("plan already executed, skipping");
    return JSON.stringify({ ...base, wouldWrite: false, reason: "plan already executed" });
  }

  // ---- gate 3: nonce ----
  // The report carries lastNonce + 1; the vault re-checks equality onchain.
  // Reading it fresh here is the workflow's half of that contract.
  const nonce = lastNonce + 1n;
  runtime.log(`nonce gate: lastNonce=${lastNonce} → reporting ${nonce}`);

  // ---- validations the vault would otherwise revert on ----
  const asOf = BigInt(observed.asOf);
  const validUntil = asOf + BigInt(observed.validitySeconds);

  if (observed.targetWethBps < 0 || observed.targetWethBps > config.maxWethBps) {
    throw new Error(`targetWethBps ${observed.targetWethBps} outside [0, ${config.maxWethBps}]`);
  }
  if (asOf > now) throw new Error(`plan asOf ${asOf} is in the future (now ${now})`);
  if (now - asOf > BigInt(config.maxPlanAgeSeconds)) {
    throw new Error(`plan is ${now - asOf}s old (MAX_PLAN_AGE ${config.maxPlanAgeSeconds}s)`);
  }
  if (validUntil < now) throw new Error(`plan expired at ${validUntil} (now ${now})`);

  const result = { ...base, nonce: nonce.toString(), asOf: asOf.toString(), validUntil: validUntil.toString(), feedAnswer: answer.toString(), wouldWrite: true };

  // ---- local simulation: log and stop. No report, no write. ----
  if (config.mode === "local-simulation") {
    runtime.log(`local-simulation, would write: ${JSON.stringify(result)}`);
    return JSON.stringify(result);
  }

  // ---- production: encode the 6-field report and write it ----
  const encoded = encodeAbiParameters(REPORT_ABI, [
    vault,
    asOf,
    validUntil,
    nonce,
    observed.targetWethBps,
    planHash,
  ]);

  const report = runtime.report(prepareReportRequest(encoded)).result();
  const write = client.writeReport(runtime, {
    receiver: vault,
    report,
    gasConfig: { gasLimit: config.gasLimit },
  }).result();

  if (write.txStatus !== TxStatus.SUCCESS) {
    throw new Error(write.errorMessage ?? `report write failed with status ${write.txStatus}`);
  }
  if (!write.txHash) throw new Error("report write succeeded without a transaction hash");

  const txHash = bytesToHex(write.txHash);
  runtime.log(`report written: ${txHash}`);
  return JSON.stringify({ ...result, txHash });
};

export const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}

main();
