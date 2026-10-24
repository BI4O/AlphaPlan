import { bytesToHex, keccak256 } from "viem";
import type { Plan } from "./schema.ts";

/**
 * Canonical serialisation for plan files.
 *
 * The plan file's raw bytes become the onchain planHash, so this module is
 * consensus-critical: if the writer emits `{"a":1,"b":2}` today and
 * `{"b":2,"a":1}` tomorrow, the same logical plan hashes differently and every
 * historical record stops matching.
 *
 * Guarantees:
 *   - Fixed key order, taken from an explicit spec — never insertion order or
 *     Object.keys() of the value being written.
 *   - The spec is checked in BOTH directions against the value: a field the
 *     schema gained but the writer did not learn throws, and so does a field the
 *     writer expects but the value lacks. "Contract changed, writer didn't"
 *     becomes a loud failure instead of a silently wrong hash.
 *   - Exactly one trailing "\n", no BOM, no CR, no trailing spaces.
 *   - Hashes are computed over bytes. NEVER parse-then-stringify to hash.
 */

/**
 * The on-disk shape. This literal order IS the byte order of the file, so the
 * twelve provenance fields (3 per opinion × 3 + 3 for the judge) must appear
 * here or they will never be written.
 */
type Node = "string" | "number" | "boolean" | { obj: Record<string, Node> } | { arr: Node };

const OPINION: Node = {
  obj: {
    agent: "string",
    model: "string",
    promptTemplateSha: "string",
    temperature: "number",
    targetWethBps: "number",
    confidence: "number",
    reason: "string",
  },
};

const PLAN: Node = {
  obj: {
    planId: "string",
    asOf: "number",
    validitySeconds: "number",
    degraded: "boolean",
    input: {
      obj: {
        ethUsd: "number",
        ethUsd24hPct: "number",
        btcUsd: "number",
        btcUsd24hPct: "number",
        vault: { obj: { navUsdc: "number", wethBps: "number" } },
      },
    },
    rounds: { arr: OPINION },
    final: {
      obj: {
        model: "string",
        promptTemplateSha: "string",
        temperature: "number",
        targetWethBps: "number",
        confidence: "number",
        rationale: "string",
      },
    },
  },
};

const pad = (n: number) => " ".repeat(n);

/**
 * Stable scalar formatting. `String(n)` is the shortest round-tripping form and
 * is specified by the language, so it does not vary between runs or engines.
 */
function scalar(value: unknown, kind: "string" | "number" | "boolean"): string {
  if (kind === "number") {
    if (typeof value !== "number") throw new Error(`canonical: expected a number, got ${typeof value}`);
    if (!Number.isFinite(value)) throw new Error(`canonical: non-finite number ${String(value)}`);
    if (Object.is(value, -0)) return "0";
    return String(value);
  }
  if (kind === "string") {
    if (typeof value !== "string") throw new Error(`canonical: expected a string, got ${typeof value}`);
    return JSON.stringify(value);
  }
  if (typeof value !== "boolean") throw new Error(`canonical: expected a boolean, got ${typeof value}`);
  return value ? "true" : "false";
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Emit one value. The returned lines carry absolute indentation. */
function emit(value: unknown, node: Node, indent: number): string[] {
  if (node === "string" || node === "number" || node === "boolean") {
    return [scalar(value, node)];
  }

  if ("arr" in node) {
    if (!Array.isArray(value)) throw new Error("canonical: expected an array");
    if (value.length === 0) return ["[]"];

    const out: string[] = ["["];
    value.forEach((item, i) => {
      const child = emit(item, node.arr, indent + 2);
      child[0] = `${pad(indent + 2)}${child[0]!.trimStart()}`;
      if (i < value.length - 1) child[child.length - 1] = `${child[child.length - 1]},`;
      out.push(...child);
    });
    out.push(`${pad(indent)}]`);
    return out;
  }

  if (!isPlainObject(value)) throw new Error("canonical: expected an object");
  const fields = Object.keys(node.obj);
  const actual = Object.keys(value);
  const missing = fields.filter((key) => !(key in value));
  const extra = actual.filter((key) => !fields.includes(key));
  if (missing.length > 0 || extra.length > 0) {
    // The drift alarm: contract and writer must change in the same commit,
    // because a field the writer does not emit can never be verified onchain.
    throw new Error(
      `canonical: field mismatch (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`,
    );
  }

  if (fields.length === 0) return ["{}"];

  const out: string[] = ["{"];
  fields.forEach((key, i) => {
    const child = emit(value[key], node.obj[key]!, indent + 2);
    child[0] = `${pad(indent + 2)}${JSON.stringify(key)}: ${child[0]!.trimStart()}`;
    if (i < fields.length - 1) child[child.length - 1] = `${child[child.length - 1]},`;
    out.push(...child);
  });
  out.push(`${pad(indent)}}`);
  return out;
}

/**
 * Serialise a validated Plan to the exact bytes that will be hashed.
 *
 * Callers MUST hash the UTF-8 bytes of this string directly. Do not re-parse it
 * before hashing; do not pretty-print it again.
 */
export function serializePlan(plan: Plan): string {
  // Exactly one trailing newline: a file without it and a file with it are
  // different bytes, and the difference shows up as a hash mismatch.
  return emit(plan, PLAN, 0).join("\n") + "\n";
}

/**
 * Round-trip guard used by `--check`:
 *   serialize -> parse -> serialize must be byte-identical.
 *
 * This is what catches the failure mode that already burned this project once:
 * a field added to the schema but not to the writer. The writer would emit a
 * file its own schema rejects (or that loses fields on re-read), and the first
 * person to notice would be a judge recomputing the hash.
 */
export function assertRoundTrip(plan: Plan, parse: (value: unknown) => Plan): void {
  const bytes = serializePlan(plan);
  const again = serializePlan(parse(JSON.parse(bytes)));
  if (bytes !== again) {
    const at = [...bytes].findIndex((ch, i) => ch !== again[i]);
    const at2 = at === -1 ? Math.min(bytes.length, again.length) : at;
    throw new Error(
      `canonical: round-trip is not stable — re-serialising the parsed plan changed byte ${at2} ` +
        `(${JSON.stringify(bytes.slice(Math.max(0, at2 - 20), at2 + 20))} vs ` +
        `${JSON.stringify(again.slice(Math.max(0, at2 - 20), at2 + 20))}). ` +
        `This plan could never be verified onchain.`,
    );
  }
}

// ---------------------------------------------------------------- byte rules

/** keccak256 over the exact bytes handed in — never over re-encoded JSON. */
export function keccakOf(bytes: Uint8Array): `0x${string}` {
  return keccak256(bytesToHex(bytes));
}

export function sha256Of(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

/**
 * Formatting problems that JSON.parse cannot see but the hash can, and that a
 * diff will not make obvious. Returned rather than thrown so `--check` can
 * report every offending file in one pass.
 */
export function checkPlanBytes(bytes: Uint8Array): string[] {
  const problems: string[] = [];

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    problems.push("starts with a UTF-8 BOM");
  }
  if (bytes.includes(0x0d)) {
    problems.push("contains CR (CRLF or old-Mac line endings) — must be LF only");
  }
  if (bytes.length === 0) return [...problems, "file is empty"];

  if (bytes[bytes.length - 1] !== 0x0a) {
    problems.push('does not end with a newline (must end with exactly one "\\n")');
  } else if (bytes.length > 1 && bytes[bytes.length - 2] === 0x0a) {
    problems.push('ends with more than one newline (must be exactly one "\\n")');
  }

  const text = new TextDecoder().decode(bytes);
  text.split("\n").forEach((line, i) => {
    if (line.trimEnd() !== line) problems.push(`trailing whitespace on line ${i + 1}`);
  });

  return problems;
}

// ------------------------------------------------------------------- the seal

/**
 * plans.lock.json — a local seal kept beside the plan directory.
 *
 * Why it exists: a committed plan deliberately carries no hash of itself, yet
 * `--check` must fail when a single byte changes. This records the hashes.
 *
 * What it is NOT: an anchor. Whoever can rewrite a plan can rewrite this too, so
 * a passing `--check` proves "not edited by accident", never "not tampered
 * with". The real anchor is the planHash in the chain event.
 */
export type PlanLockEntry = {
  file: string;
  bytes: number;
  sha256: string;
  keccak256: `0x${string}`;
};

export type PlanLock = {
  version: 1;
  plans: Record<string, PlanLockEntry>;
};

export function serializeLock(lock: PlanLock): string {
  const ids = Object.keys(lock.plans).sort();
  const lines: string[] = ["{", `  "version": 1,`];

  if (ids.length === 0) {
    lines.push(`  "plans": {}`);
  } else {
    lines.push(`  "plans": {`);
    ids.forEach((id, i) => {
      const entry = lock.plans[id]!;
      lines.push(`    ${JSON.stringify(id)}: {`);
      lines.push(`      "file": ${JSON.stringify(entry.file)},`);
      lines.push(`      "bytes": ${entry.bytes},`);
      lines.push(`      "sha256": ${JSON.stringify(entry.sha256)},`);
      lines.push(`      "keccak256": ${JSON.stringify(entry.keccak256)}`);
      lines.push(`    }${i === ids.length - 1 ? "" : ","}`);
    });
    lines.push(`  }`);
  }

  lines.push("}");
  return lines.join("\n") + "\n";
}

export function parseLock(text: string): PlanLock {
  const raw = JSON.parse(text) as unknown;
  if (!isPlainObject(raw)) throw new Error("lock file is not an object");
  const obj = raw as { version?: unknown; plans?: unknown };
  if (obj.version !== 1) throw new Error(`unsupported lock version: ${String(obj.version)}`);
  if (!isPlainObject(obj.plans)) throw new Error("lock file has no plans map");

  const plans: Record<string, PlanLockEntry> = {};
  for (const [id, value] of Object.entries(obj.plans)) {
    const entry = value as Partial<PlanLockEntry>;
    if (
      typeof entry.file !== "string" ||
      typeof entry.bytes !== "number" ||
      typeof entry.sha256 !== "string" ||
      typeof entry.keccak256 !== "string" ||
      !/^0x[0-9a-f]{64}$/.test(entry.keccak256) ||
      !/^[0-9a-f]{64}$/.test(entry.sha256)
    ) {
      throw new Error(`malformed lock entry for plan ${id}`);
    }
    plans[id] = {
      file: entry.file,
      bytes: entry.bytes,
      sha256: entry.sha256,
      keccak256: entry.keccak256 as `0x${string}`,
    };
  }
  return { version: 1, plans };
}
