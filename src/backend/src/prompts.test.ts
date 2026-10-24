import { describe, expect, test } from "bun:test";
import { keccakOf } from "./canonical.ts";
import {
  PROMPT_NAMES,
  loadPromptTemplates,
  renderAgentUserMessage,
  renderJudgeUserMessage,
  type PromptName,
} from "./prompts.ts";
import { parsePlan, type AgentOpinion } from "./schema.ts";
import { fixturePlan } from "./fixtures.ts";

/**
 * Expected values were produced with an independent implementation:
 *
 *   cast keccak 0x$(xxd -p -c 1000000 prompts/bull.txt | tr -d '\n')
 *
 * NOT with the bare form `cast keccak $(xxd -p …)`, which hashes the ASCII of
 * the hex string rather than the file bytes (see the last test in this file).
 */
const EXPECTED: Record<PromptName, `0x${string}`> = {
  bull: "0xceb2a196bb23d0116cc8f56d3664d310e5aa9725998624ff655b7086fc28b1f7",
  bear: "0x3497e792e2d5922b1dc5d267ab881412558438cb17779270b2a8a0c8c41d3ccd",
  risk: "0x2854e9da2c5c7251d69bfadb47c7109fecaa5c5ebcee54bc8cb85f112742ef66",
  judge: "0xd37d3c2b09ea95b65db915969b4fd246da5ab91a084506eb5cccd30cad76ff3e",
};

describe("prompt templates are committed files we hash", () => {
  test("all four exist and hash to the recorded values", async () => {
    const templates = await loadPromptTemplates();
    for (const name of PROMPT_NAMES) {
      const template = templates[name];
      expect(template.path).toBe(`prompts/${name}.txt`);
      expect(template.text.length).toBeGreaterThan(200);
      expect(template.keccak256).toBe(EXPECTED[name]!);
    }
    expect(Object.keys(templates).sort()).toEqual([...PROMPT_NAMES].sort());
  });

  test("the hash is over file bytes, not over a re-encoded copy", async () => {
    const file = Bun.file("prompts/bull.txt");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const templates = await loadPromptTemplates();
    expect(templates.bull!.keccak256).toBe(keccakOf(bytes));
    // Re-encoding the text must give the same bytes here (no BOM, no CRLF) —
    // asserted rather than assumed, because a CRLF template would silently
    // hash differently on a Windows checkout.
    expect(keccakOf(new TextEncoder().encode(templates.bull!.text))).toBe(templates.bull!.keccak256);
  });

  test("templates mention the mandate so the band is not carried only by zod", async () => {
    const templates = await loadPromptTemplates();
    for (const name of PROMPT_NAMES) {
      expect(templates[name]!.text).toContain("6000");
      expect(templates[name]!.text).toContain("JSON");
    }
  });
});

describe("rendered messages", () => {
  test("every agent sees the same authoritative input", async () => {
    const plan = fixturePlan();
    const message = renderAgentUserMessage(plan.input);
    const parsed = JSON.parse(message) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["btcUsd", "btcUsd24hPct", "ethUsd", "ethUsd24hPct", "vault"]);
    expect(parsed.ethUsd).toBe(2385.06);
  });

  test("the judge sees the three opinions but not their provenance", () => {
    const plan = fixturePlan();
    const message = renderJudgeUserMessage(plan.input, plan.rounds as AgentOpinion[]);
    const parsed = JSON.parse(message) as { rounds: Array<Record<string, unknown>> };
    expect(parsed.rounds).toHaveLength(3);
    expect(Object.keys(parsed.rounds[0]!).sort()).toEqual(["agent", "confidence", "reason", "targetWethBps"]);
    expect(message).not.toContain("promptTemplateSha");
  });
});

describe("trap: the bare cast keccak form hashes the hex text", () => {
  test("keccak(hex-of-file-as-text) differs from keccak(file bytes)", async () => {
    const bytes = new Uint8Array(await Bun.file("prompts/bull.txt").arrayBuffer());
    const hexText = Buffer.from(bytes).toString("hex");
    const wrong = keccakOf(new TextEncoder().encode(hexText));
    const right = keccakOf(bytes);
    expect(right).toBe(EXPECTED.bull!);
    // 0x42aeb3… is what `cast keccak $(xxd -p …)` returns: a hash of characters.
    expect(wrong).toBe("0x42aeb3c9d6d026eee7a7c446bd2051f258e608d85afa04d930b58a99f33cb98a");
    expect(wrong).not.toBe(right);
  });

  test("every prompt would be hashed wrong by the bare form", async () => {
    const templates = await loadPromptTemplates();
    for (const name of PROMPT_NAMES) {
      const bytes = new TextEncoder().encode(templates[name]!.text);
      const wrong = keccakOf(new TextEncoder().encode(Buffer.from(bytes).toString("hex")));
      expect(wrong).not.toBe(templates[name]!.keccak256);
    }
  });
});

describe("offline plan uses the real template hashes", () => {
  test("so a third party can recompute them from the repo", async () => {
    const templates = await loadPromptTemplates();
    const { offlinePlan } = await import("./debate.ts");
    const plan = parsePlan(offlinePlan(1_792_810_800, templates));
    expect(plan.degraded).toBe(true);
    expect(plan.rounds[0]!.promptTemplateSha).toBe(EXPECTED.bull!);
    expect(plan.rounds[1]!.promptTemplateSha).toBe(EXPECTED.bear!);
    expect(plan.rounds[2]!.promptTemplateSha).toBe(EXPECTED.risk!);
    expect(plan.final.promptTemplateSha).toBe(EXPECTED.judge!);
  });
});
