/**
 * Shared test fixture: a structurally valid plan. Not imported by production
 * code; it exists so the writer, the parser and the CLI tests all describe the
 * same record.
 */
import { DEFAULT_VALIDITY_SECONDS, parsePlan, type Plan } from "./schema.ts";

const SHA = `0x${"ab".repeat(32)}`;

export const fixturePlan = (): Plan =>
  parsePlan({
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
    rounds: [
      { agent: "bull", model: "m", promptTemplateSha: SHA, temperature: 0, targetWethBps: 4500, confidence: 0.6, reason: "up" },
      { agent: "bear", model: "m", promptTemplateSha: SHA, temperature: 0, targetWethBps: 1500, confidence: 0.55, reason: "down" },
      { agent: "risk", model: "m", promptTemplateSha: SHA, temperature: 0, targetWethBps: 3000, confidence: 0.7, reason: "steady" },
    ],
    final: { model: "m", promptTemplateSha: SHA, temperature: 0, targetWethBps: 3200, confidence: 0.58, rationale: "split" },
  });
