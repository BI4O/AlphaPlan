import { z } from "zod";

/**
 * The plan file's raw bytes are the artifact that gets hashed onchain.
 * Any change to this schema changes what a valid plan looks like — and
 * therefore what historical plan hashes mean.
 *
 * Two quantities get called "bps" in prose, and they are NOT the same thing:
 *
 *   target     — a *decision*: where the vault should be. The mandate caps risk
 *                at MAX_WETH_BPS = 6000 (PRD §3.2), and the contract rejects
 *                anything above it instead of silently clamping. A plan that
 *                names a position the vault cannot hold is a bug in the debate
 *                layer, so it is rejected *here*, before it becomes evidence —
 *                not deferred to an onchain revert (ACCEPTANCE B5).
 *
 *   observed   — a *measurement*: where the vault actually is right now. This
 *                can legitimately exceed 6000: ETH rallies while the vault sits
 *                idle and the WETH share grows with no trade. Measured state is
 *                recorded as measured, never clipped to the band.
 */

/** Contract MAX_WETH_BPS — risk asset may be at most 60% (PRD §3.2 / §5). */
export const MAX_TARGET_WETH_BPS = 6000;
export const MIN_TARGET_WETH_BPS = 0;

/** A fully invested vault is 100%; measurements use the full range. */
export const MAX_OBSERVED_WETH_BPS = 10_000;

/** PRD §5: 900s covers one 600s cron cycle with margin for queueing. */
export const DEFAULT_VALIDITY_SECONDS = 900;

/** Contract MAX_PLAN_AGE — a backstop; validUntil is the primary constraint. */
export const MAX_PLAN_AGE_SECONDS = 3600;

/** `model` sentinel for the fixed sample: no model produced it. */
export const OFFLINE_MODEL = "offline-sample";

/** The three debating agents, in the order the record must list them. */
export const AGENTS = ["bull", "bear", "risk"] as const;
export type Agent = (typeof AGENTS)[number];

const targetWethBps = z
  .number()
  .int()
  .min(MIN_TARGET_WETH_BPS)
  .max(MAX_TARGET_WETH_BPS, {
    message: `targetWethBps must be <= ${MAX_TARGET_WETH_BPS} (MAX_WETH_BPS); the vault cannot hold more`,
  });

const observedWethBps = z.number().int().min(0).max(MAX_OBSERVED_WETH_BPS);

/**
 * Model provenance (PRD §7.2).
 *
 * These fields make the plan hash commit to *which model produced the decision*,
 * not merely to its output: "we hashed an answer" becomes "we hashed the model +
 * prompt + answer", which is what the Verifiable AI track calls 链上模型溯源.
 *
 * Honest limit, stated once so nobody overclaims later: this is a SELF-REPORT.
 * The file claims which model ran; nothing here proves it. Only zkML or a TEE
 * attestation would (README §9.3). We commit to the claim so it cannot change
 * quietly later.
 */
const modelProvenance = z.object({
  /** Provider's own model identifier, e.g. "claude-sonnet-4-5". */
  model: z.string().min(1),
  /**
   * keccak256 of the exact bytes of `prompts/<agent>.txt`.
   *
   * The template is committed to the repository — hashing a string nobody can
   * obtain would make "we can verify which prompt was used" an empty claim.
   * Third-party recomputation:
   *   cast keccak 0x$(xxd -p -c 1000000 src/backend/prompts/bull.txt | tr -d '\n')
   */
  promptTemplateSha: z.string().regex(/^0x[0-9a-f]{64}$/, {
    message: "promptTemplateSha must be 0x-prefixed 32-byte hex (keccak256 of prompts/<agent>.txt)",
  }),
  /**
   * Sampling temperature. Pinned to 0: any other value makes the record
   * non-reproducible, which defeats the point of committing to it.
   */
  temperature: z.literal(0),
});

const agentOpinion = z
  .object({
    agent: z.enum(AGENTS),
    // Provenance is part of the opinion, so planHash covers it.
    ...modelProvenance.shape,
    // Opinions are held to the same band as verdicts: an opinion of 8000 could
    // never be executed, and storing it would let a reader believe a >60%
    // position was ever on the table. Express conviction with `confidence` and
    // `reason`, not with an impossible position.
    targetWethBps,
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1),
  })
  // `.strict()` surfaces an accidental duplicate of a provenance key instead of
  // silently merging it.
  .strict();

/**
 * What an agent may return over the wire. The caller adds `agent` and the
 * provenance, so a model cannot name itself into the record.
 */
export const agentOpinionOutputSchema = z.object({
  targetWethBps,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});

/** What the judge may return over the wire. */
export const finalVerdictOutputSchema = z.object({
  targetWethBps,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

export const planSchema = z.object({
  planId: z.string().min(1),
  asOf: z.number().int().positive(),
  validitySeconds: z.number().int().positive(),

  // Required, not optional-with-default-false: a degraded run must say so.
  //
  // PM ruling: KEEP REQUIRED. An offline plan and a live plan look identical
  // onchain (both are just a planHash); `degraded` is the only thing that lets
  // verify and the frontend mark a record as a sample rather than a real
  // decision. The workflow additionally REFUSES to submit a degraded plan
  // (PRD §6 step 5), so this field is a safety boundary, not a comment.
  degraded: z.boolean(),

  input: z.object({
    ethUsd: z.number().positive(),
    ethUsd24hPct: z.number(),
    btcUsd: z.number().positive(),
    btcUsd24hPct: z.number(),
    vault: z.object({
      navUsdc: z.number().nonnegative(),
      wethBps: observedWethBps,
    }),
  }),

  // Exactly three opinions, one per agent, in canonical order: `.length(3)`
  // alone would accept three bulls.
  rounds: z
    .array(agentOpinion)
    .length(AGENTS.length)
    .superRefine((rounds, ctx) => {
      rounds.forEach((round, i) => {
        const expected = AGENTS[i]!;
        if (round.agent !== expected) {
          ctx.addIssue({
            code: "custom",
            path: [i, "agent"],
            message: `rounds[${i}].agent must be "${expected}" (order is ${AGENTS.join(", ")})`,
          });
        }
      });
    }),

  // The judge declares its model too: the chain records which model arbitrated,
  // not only which models argued.
  final: z
    .object({
      ...modelProvenance.shape,
      targetWethBps,
      confidence: z.number().min(0).max(1),
      rationale: z.string().min(1),
    })
    .strict(),
});

export type Plan = z.infer<typeof planSchema>;
export type AgentOpinion = z.infer<typeof agentOpinion>;

/** Exactly the `input` object of a plan: the authoritative data the agents saw. */
export type MarketInput = Plan["input"];
export type PlanProvenance = z.infer<typeof modelProvenance>;

export class PlanValidationError extends Error {
  override name = "PlanValidationError";
}

/** Parse an unknown value into a Plan, throwing with every zod issue listed. */
export function parsePlan(value: unknown): Plan {
  const result = planSchema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new PlanValidationError(issues);
  }
  return result.data;
}

/**
 * Invariants the schema alone cannot express (PLAN P2).
 *
 * A plan whose validitySeconds exceeds MAX_PLAN_AGE would be rejected by the
 * vault for its entire life, so catching it here turns a confusing onchain
 * revert into a clear local error.
 */
export function assertPlanInvariants(plan: Plan): void {
  if (plan.validitySeconds > MAX_PLAN_AGE_SECONDS) {
    throw new PlanValidationError(
      `validitySeconds (${plan.validitySeconds}) must be <= MAX_PLAN_AGE (${MAX_PLAN_AGE_SECONDS}); ` +
        `the vault would reject this plan as too old for its whole life`,
    );
  }
}
