import { describe, expect, test } from "bun:test";
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
import { parsePlan, type Plan } from "./schema.ts";
import { fixturePlan } from "./fixtures.ts";

const roundTrip = (text: string): string => serializePlan(parsePlan(JSON.parse(text)));

describe("serializePlan — fixed bytes", () => {
  test("round-trip through the parser is byte-identical (the anti-drift guard)", () => {
    const plan = fixturePlan();
    const text = serializePlan(plan);
    expect(roundTrip(text)).toBe(text);
    expect(() => assertRoundTrip(plan, parsePlan)).not.toThrow();
  });

  test("emits all four provenance field sets: 4 model + 4 promptTemplateSha + 4 temperature", () => {
    const text = serializePlan(fixturePlan());
    const count = (needle: string) => text.split(needle).length - 1;
    expect(count('"model"')).toBe(4);
    expect(count('"promptTemplateSha"')).toBe(4);
    expect(count('"temperature"')).toBe(4);
  });

  test("a field the schema gained but the writer ignores is refused, not silently dropped", () => {
    const plan = fixturePlan();
    const { model: _model, ...withoutModel } = plan.final;
    const broken = { ...plan, final: withoutModel } as unknown as Plan;
    expect(() => serializePlan(broken)).toThrow(/field mismatch.*model/);
  });

  test("an extra field nobody declared is refused", () => {
    const plan = fixturePlan();
    const broken = { ...plan, surprise: 1 } as unknown as Plan;
    expect(() => serializePlan(broken)).toThrow(/field mismatch.*surprise/);
  });

  test("key order is fixed regardless of insertion order", () => {
    const plan = fixturePlan();
    const shuffled = { final: plan.final, rounds: plan.rounds, planId: plan.planId, degraded: plan.degraded, input: plan.input, asOf: plan.asOf, validitySeconds: plan.validitySeconds } as unknown as Plan;
    expect(serializePlan(shuffled)).toBe(serializePlan(plan));
  });

  test("bytes are LF-free of BOM, trailing spaces, and end with exactly one newline", () => {
    const bytes = new TextEncoder().encode(serializePlan(fixturePlan()));
    expect(checkPlanBytes(bytes)).toEqual([]);
    expect(bytes[bytes.length - 1]).toBe(0x0a);
    expect(bytes[bytes.length - 2]).not.toBe(0x0a);
  });
});

describe("checkPlanBytes — what a diff hides and the hash exposes", () => {
  const encode = (s: string) => new TextEncoder().encode(s);
  const clean = "{\n  \"a\": 1\n}\n";

  test("clean input reports nothing", () => {
    expect(checkPlanBytes(encode(clean))).toEqual([]);
  });

  test("BOM", () => {
    expect(checkPlanBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...encode(clean)]))).toContain("starts with a UTF-8 BOM");
  });

  test("CRLF", () => {
    expect(checkPlanBytes(encode(clean.replace(/\n/g, "\r\n")))).toContain(
      "contains CR (CRLF or old-Mac line endings) — must be LF only",
    );
  });

  test("no trailing newline", () => {
    expect(checkPlanBytes(encode(clean.trimEnd()))[0]).toMatch(/does not end with a newline/);
  });

  test("two trailing newlines", () => {
    expect(checkPlanBytes(encode(`${clean}\n`))[0]).toMatch(/more than one newline/);
  });

  test("trailing whitespace", () => {
    expect(checkPlanBytes(encode("{\n  \"a\": 1 \n}\n")).join()).toMatch(/trailing whitespace on line 2/);
  });
});

describe("hashes are over bytes", () => {
  test("keccak256 of empty input is the canonical value", () => {
    expect(keccakOf(new Uint8Array())).toBe("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  });

  test('keccak256 of "abc" is the canonical value', () => {
    expect(keccakOf(new TextEncoder().encode("abc"))).toBe(
      "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
    );
  });

  test("sha256 of empty input is the canonical value", () => {
    expect(sha256Of(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("plans.lock.json", () => {
  const lock: PlanLock = {
    version: 1,
    plans: {
      "2026-10-24T03:00:00Z": {
        file: "2026-10-24T03:00:00Z.json",
        bytes: 100,
        sha256: "a".repeat(64),
        keccak256: `0x${"b".repeat(64)}`,
      },
      "2026-10-24T04:00:00Z": {
        file: "2026-10-24T04:00:00Z.json",
        bytes: 200,
        sha256: "c".repeat(64),
        keccak256: `0x${"d".repeat(64)}`,
      },
    },
  };

  test("round-trips and orders plan ids", () => {
    const text = serializeLock(lock);
    expect(parseLock(text)).toEqual(lock);
    expect(text.indexOf("03:00:00Z")).toBeLessThan(text.indexOf("04:00:00Z"));
    expect(text.endsWith("\n")).toBe(true);
  });

  test("rejects a malformed entry", () => {
    expect(() => parseLock(JSON.stringify({ version: 1, plans: { x: { file: "x.json" } } }))).toThrow(/malformed/);
  });

  test("rejects an unknown version", () => {
    expect(() => parseLock(JSON.stringify({ version: 2, plans: {} }))).toThrow(/version/);
  });
});
