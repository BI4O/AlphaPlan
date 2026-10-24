import { keccakOf } from "./canonical.ts";
import { AGENTS, type AgentOpinion, type MarketInput } from "./schema.ts";

/**
 * Prompt templates live in `prompts/*.txt` and are committed to git, because
 * the plan file records `promptTemplateSha = keccak256(template bytes)`.
 * Hashing a string nobody can obtain would make "we can verify which prompt was
 * used" an empty claim; hashing a committed file makes it third-party
 * recomputable:
 *
 *   cast keccak 0x$(xxd -p -c 1000000 src/backend/prompts/bull.txt | tr -d '\n')
 *
 * Templates contain no placeholders: they describe the JSON input, and the
 * rendered values are carried by `input` in the plan file. There is therefore
 * nothing to hash twice — the template plus the input fully determine the ask.
 */

export const PROMPT_NAMES = [...AGENTS, "judge"] as const;
export type PromptName = (typeof PROMPT_NAMES)[number];

export type PromptTemplate = {
  name: PromptName;
  path: string;
  text: string;
  keccak256: `0x${string}`;
};

const cache = new Map<string, Promise<Record<PromptName, PromptTemplate>>>();

async function readAll(dir: string): Promise<Record<PromptName, PromptTemplate>> {
  const entries = await Promise.all(
    PROMPT_NAMES.map(async (name) => {
      const path = `${dir}/${name}.txt`;
      const file = Bun.file(path);
      if (!(await file.exists())) {
        throw new Error(`missing prompt template: ${path} — it must be committed, not generated at runtime`);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length === 0) throw new Error(`prompt template is empty: ${path}`);
      return [name, { name, path, text: new TextDecoder().decode(bytes), keccak256: keccakOf(bytes) }] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<PromptName, PromptTemplate>;
}

/** Read all four templates, memoised per directory. */
export function loadPromptTemplates(dir = "prompts"): Promise<Record<PromptName, PromptTemplate>> {
  const cached = cache.get(dir);
  if (cached) return cached;
  const loaded = readAll(dir);
  cache.set(dir, loaded);
  return loaded;
}

/** Test seam: forget cached templates (used when a test rewrites a template). */
export function resetPromptCache(): void {
  cache.clear();
}

const indent = (value: unknown) => JSON.stringify(value, null, 2);

/** What each debating agent sees: the same authoritative input, verbatim. */
export function renderAgentUserMessage(input: MarketInput): string {
  return indent(input);
}

/**
 * What the judge sees: the same input plus the three opinions. Provenance is
 * stripped — the judge is deciding on reasoning, not on model names.
 */
export function renderJudgeUserMessage(input: MarketInput, rounds: AgentOpinion[]): string {
  return indent({
    input,
    rounds: rounds.map(({ agent, targetWethBps, confidence, reason }) => ({
      agent,
      targetWethBps,
      confidence,
      reason,
    })),
  });
}
