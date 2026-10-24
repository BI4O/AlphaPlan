/**
 * Minimal OpenAI-compatible chat client.
 *
 * The pinned provider is DeepSeek (`https://api.deepseek.com`, OpenAI wire
 * format). One request shape, no SDK, and two models:
 *
 *   deepseek-flash    the three debaters — fast and cheap, three parallel calls
 *   deepseek-v4-pro   the judge — the stronger model arbitrates the debate
 *
 * That split is real: the judge is a stronger model, not just a stronger prompt.
 * The plan file records each call's actual model name, because claiming four
 * different vendors would be a lie the README's §9.3 honesty boundary forbids.
 *
 * The debate is offchain on purpose (PRD §7.1): several LLM round trips take
 * longer than a CRE HTTP request may, so the chain only ever sees
 * "fetch file + hash + report".
 */

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  /** Model for bull / bear / risk. */
  model: string;
  /** Model for the judge. Defaults to a stronger one. */
  judgeModel: string;
  maxTokens: number;
  timeoutMs: number;
  /** Ask for `response_format: json_object`; disable for providers that 400 on it. */
  jsonMode: boolean;
  /** Optional `reasoning_effort` (DeepSeek accepts low / high / max). */
  effort?: string;
};

export type ChatRequest = {
  system: string;
  user: string;
  /** Only for error messages: "bull opinion", "judge verdict", … */
  what: string;
};

export type Env = Record<string, string | undefined>;

/** Every call runs at temperature 0 — a nonzero value makes the record non-reproducible. */
export const LLM_TEMPERATURE = 0;

export const DEFAULT_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_AGENT_MODEL = "deepseek-flash";
export const DEFAULT_JUDGE_MODEL = "deepseek-v4-pro";

/**
 * DeepSeek bills `reasoning_content` into completion_tokens, so a small
 * max_tokens returns an empty `content` with finish_reason=length (measured:
 * 10 is too small, 800 works). Anything below 800 is rejected at startup rather
 * than discovered as an empty debate.
 */
export const MIN_MAX_TOKENS = 800;
export const DEFAULT_MAX_TOKENS = 2000;

export function llmFromEnv(env: Env = process.env): LlmConfig | null {
  const apiKey = env.DEBATE_LLM_API_KEY ?? env.DEEPSEEK_API_KEY ?? env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const maxTokens = Number(env.DEBATE_LLM_MAX_TOKENS ?? DEFAULT_MAX_TOKENS);
  if (!Number.isFinite(maxTokens) || maxTokens < MIN_MAX_TOKENS) {
    throw new Error(
      `DEBATE_LLM_MAX_TOKENS=${env.DEBATE_LLM_MAX_TOKENS} is below ${MIN_MAX_TOKENS}. ` +
        `DeepSeek counts reasoning_content toward completion_tokens, so a small value returns empty content with finish_reason=length.`,
    );
  }

  return {
    baseUrl: (env.DEBATE_LLM_BASE_URL ?? env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    apiKey,
    model: env.DEBATE_LLM_MODEL ?? DEFAULT_AGENT_MODEL,
    judgeModel: env.DEBATE_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL,
    maxTokens,
    timeoutMs: Number(env.DEBATE_LLM_TIMEOUT_MS ?? 120_000),
    jsonMode: env.DEBATE_LLM_JSON_MODE !== "0",
    ...(env.DEBATE_LLM_EFFORT ? { effort: env.DEBATE_LLM_EFFORT } : {}),
  };
}

/** Pull a JSON object out of a reply that may be fenced or padded with prose. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? text).trim();

  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
    throw new Error(`reply is not JSON: ${body.slice(0, 200)}`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The exact request body we send. Exported so a test can assert the fields. */
export function requestBody(config: LlmConfig, request: ChatRequest, model: string): Record<string, unknown> {
  return {
    model,
    temperature: LLM_TEMPERATURE,
    max_tokens: config.maxTokens,
    ...(config.effort ? { reasoning_effort: config.effort } : {}),
    ...(config.jsonMode ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
  };
}

type Completion = {
  choices?: Array<{
    message?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string;
  }>;
  error?: { message?: string };
};

export async function completeJson(
  config: LlmConfig,
  request: ChatRequest,
  options: { model?: string; attempts?: number; transport?: typeof fetch } = {},
): Promise<unknown> {
  const attempts = options.attempts ?? 3;
  const transport = options.transport ?? fetch;
  const model = options.model ?? config.model;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await transport(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(requestBody(config, request, model)),
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(`HTTP ${response.status} for ${request.what} (${model}): ${detail}`);
      }

      const payload = (await response.json()) as Completion;
      const choice = payload.choices?.[0];
      const content = choice?.message?.content;

      if (!content) {
        const reasoning = choice?.message?.reasoning_content?.length ?? 0;
        throw new Error(
          `empty content for ${request.what} (${model}): finish_reason=${choice?.finish_reason ?? "?"}, ` +
            `reasoning_content=${reasoning} chars, max_tokens=${config.maxTokens}` +
            (payload.error?.message ? `, error=${payload.error.message}` : ""),
        );
      }

      return extractJson(content);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(500 * attempt);
    }
  }

  throw new Error(`LLM call failed after ${attempts} attempts (${request.what}, ${model}): ${errorMessage(lastError)}`);
}

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
