import { describe, expect, test } from "bun:test";
import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_BASE_URL,
  DEFAULT_JUDGE_MODEL,
  MIN_MAX_TOKENS,
  completeJson,
  llmFromEnv,
  requestBody,
  type LlmConfig,
} from "./llm.ts";

const config: LlmConfig = {
  baseUrl: DEFAULT_BASE_URL,
  apiKey: "test-key",
  model: DEFAULT_AGENT_MODEL,
  judgeModel: DEFAULT_JUDGE_MODEL,
  maxTokens: 2000,
  timeoutMs: 1000,
  jsonMode: true,
};

describe("DeepSeek defaults", () => {
  test("base URL and the two models are pinned", () => {
    expect(DEFAULT_BASE_URL).toBe("https://api.deepseek.com");
    expect(DEFAULT_AGENT_MODEL).toBe("deepseek-flash");
    expect(DEFAULT_JUDGE_MODEL).toBe("deepseek-v4-pro");
  });

  test("reads DEEPSEEK_API_KEY and keeps every field overridable", () => {
    const fromEnv = llmFromEnv({ DEEPSEEK_API_KEY: "k" })!;
    expect(fromEnv.apiKey).toBe("k");
    expect(fromEnv.baseUrl).toBe("https://api.deepseek.com");
    expect(fromEnv.model).toBe("deepseek-flash");
    expect(fromEnv.judgeModel).toBe("deepseek-v4-pro");

    const overridden = llmFromEnv({
      DEEPSEEK_API_KEY: "k",
      DEBATE_LLM_BASE_URL: "http://localhost:8080/v1/",
      DEBATE_LLM_MODEL: "deepseek-v4-pro",
      DEBATE_JUDGE_MODEL: "deepseek-flash",
      DEBATE_LLM_MAX_TOKENS: "1200",
      DEBATE_LLM_EFFORT: "high",
      DEBATE_LLM_JSON_MODE: "0",
    })!;
    expect(overridden.baseUrl).toBe("http://localhost:8080/v1");
    expect(overridden.model).toBe("deepseek-v4-pro");
    expect(overridden.judgeModel).toBe("deepseek-flash");
    expect(overridden.maxTokens).toBe(1200);
    expect(overridden.effort).toBe("high");
    expect(overridden.jsonMode).toBe(false);
  });

  test("no key means no config (so --offline is the only path)", () => {
    expect(llmFromEnv({})).toBeNull();
  });

  test(`max_tokens below ${MIN_MAX_TOKENS} is refused at startup`, () => {
    // Measured on the real API: max_tokens=10 returns content="" with
    // finish_reason=length, because reasoning_content is billed as completion.
    expect(() => llmFromEnv({ DEEPSEEK_API_KEY: "k", DEBATE_LLM_MAX_TOKENS: "10" })).toThrow(/reasoning_content/);
    expect(() => llmFromEnv({ DEEPSEEK_API_KEY: "k", DEBATE_LLM_MAX_TOKENS: "800" })).not.toThrow();
  });
});

describe("request body", () => {
  const request = { system: "sys", user: "usr", what: "test" };

  test("temperature is 0 and max_tokens is generous", () => {
    const body = requestBody(config, request, config.model) as Record<string, unknown>;
    expect(body.temperature).toBe(0);
    expect(body.max_tokens as number).toBeGreaterThanOrEqual(MIN_MAX_TOKENS);
    expect(body.model).toBe("deepseek-flash");
  });

  test("the judge call can name a different model", () => {
    const body = requestBody(config, request, config.judgeModel) as Record<string, unknown>;
    expect(body.model).toBe("deepseek-v4-pro");
  });

  test("json mode and effort are opt-in", () => {
    expect((requestBody(config, request, "m") as Record<string, unknown>).response_format).toEqual({ type: "json_object" });
    expect((requestBody(config, request, "m") as Record<string, unknown>).reasoning_effort).toBeUndefined();
    const withEffort = requestBody({ ...config, effort: "max" }, request, "m") as Record<string, unknown>;
    expect(withEffort.reasoning_effort).toBe("max");
  });
});

describe("completeJson", () => {
  const request = { system: "sys", user: "usr", what: "bull opinion" };

  test("parses a fenced reply", async () => {
    const transport = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: '```json\n{"targetWethBps": 3200}\n```' }, finish_reason: "stop" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    await expect(completeJson(config, request, { transport })).resolves.toEqual({ targetWethBps: 3200 });
  });

  test("an empty content names finish_reason and the token budget", async () => {
    const transport = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "", reasoning_content: "thinking…" }, finish_reason: "length" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    await expect(completeJson(config, request, { transport, attempts: 1 })).rejects.toThrow(
      /empty content .*finish_reason=length/,
    );
  });

  test("a provider error is surfaced with its body, not swallowed", async () => {
    const transport = (async () => new Response('{"error":{"message":"Invalid model"}}', { status: 400 })) as unknown as typeof fetch;
    await expect(completeJson(config, request, { transport, attempts: 1 })).rejects.toThrow(/HTTP 400.*Invalid model/);
  });
});
