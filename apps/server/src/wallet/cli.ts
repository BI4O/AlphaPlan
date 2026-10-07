/**
 * The single chokepoint to the wallet CLI.
 *
 * Every `baw` process in this project is spawned here and nowhere else. That is what makes
 * `assertReadOnly()` a real boundary instead of a suggestion, and it is also what makes the later
 * move to a separate broker process a one-file change (see the README's security section).
 *
 * Rules:
 *  - the policy check runs *before* the process exists
 *  - `execFile` with an argv array, never a shell, so no caller can inject shell syntax
 *  - `--json` is appended here, so no caller can forget it
 *  - the audit log records the command path and flag *names* only, never values: argv can carry
 *    addresses and payloads, and stdout can carry session material
 */

import { execFile } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { envText, REPO_ROOT } from "../config.ts";
import { assertReadOnly, commandPath } from "./policy.ts";

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

// Read lazily, not at module load: `../config.ts` loads `.env` as a side effect, and module
// evaluation order would otherwise decide whether these see it.
const bawBin = (): string => envText("BAW_BIN") ?? "baw";
const defaultTimeoutMs = (): number => Number(envText("BAW_TIMEOUT_MS") ?? 30_000);
const auditLogPath = (): string => envText("BAW_AUDIT_LOG") ?? resolve(REPO_ROOT, "data", "baw-audit.jsonl");
const auditEnabled = (): boolean => envText("BAW_AUDIT_LOG") !== "off";

export interface BawCallResult {
	/** the argv actually executed, including `--json` */
	argv: string[];
	/** true when the process exited 0 and the JSON envelope did not report `success: false` */
	ok: boolean;
	/** the `data` field of the CLI's `--json` envelope, when it parsed */
	data: unknown;
	/** raw stdout, always present: the CLI's own error text must reach the caller verbatim */
	raw: string;
	stderr: string;
	exitCode: number | null;
	durationMs: number;
}

export class BawNotInstalledError extends Error {
	constructor(bin: string) {
		super(
			`${bin} was not found on PATH. Install the pinned CLI: ` +
				"pnpm add -g @binance/agentic-wallet@<version from the skill's requiredCliVersion>",
		);
		this.name = "BawNotInstalledError";
	}
}

interface ExecOutcome {
	stdout: string;
	stderr: string;
	exitCode: number | null;
}

function execFileAsync(file: string, args: readonly string[], timeoutMs: number): Promise<ExecOutcome> {
	return new Promise((resolvePromise, rejectPromise) => {
		execFile(
			file,
			[...args],
			{ timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8", windowsHide: true },
			(error, stdout, stderr) => {
				const err = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
				if (err !== null && err.code === "ENOENT") {
					rejectPromise(new BawNotInstalledError(file));
					return;
				}
				// A non-zero exit is a normal outcome, not an exception: the caller has to relay the
				// CLI's own message (see the skill's error-handling rules).
				const code = typeof err?.code === "number" ? err.code : err === null ? 0 : 1;
				resolvePromise({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: err === null ? 0 : code });
			},
		);
	});
}

/** The CLI writes a single JSON envelope; tolerate a warning line before it. */
function parseEnvelope(raw: string): { success?: boolean; data?: unknown } | undefined {
	const trimmed = raw.trim();
	if (trimmed === "") return undefined;
	const start = trimmed.indexOf("{");
	if (start === -1) return undefined;
	try {
		const parsed: unknown = JSON.parse(trimmed.slice(start));
		if (typeof parsed !== "object" || parsed === null) return undefined;
		return parsed as { success?: boolean; data?: unknown };
	} catch {
		return undefined;
	}
}

/** Flag names only — never flag values, never stdout. */
function auditShape(argv: readonly string[]): string {
	const path = commandPath(argv).join(" ");
	const flags = argv.filter((token) => token.startsWith("--")).map((token) => token.split("=", 1)[0]);
	return [path, ...flags].join(" ");
}

async function writeAudit(line: Record<string, unknown>): Promise<void> {
	if (!auditEnabled()) return;
	try {
		await mkdir(dirname(auditLogPath()), { recursive: true });
		await appendFile(auditLogPath(), `${JSON.stringify(line)}\n`, "utf8");
	} catch {
		// A failed audit write must not fail a read, and must not be silent either.
		console.error(`[wallet] could not append to the audit log at ${auditLogPath()}`);
	}
}

/**
 * Run a read-only `baw` command.
 *
 * Throws {@link WalletPolicyError} for anything the policy refuses and {@link BawNotInstalledError}
 * when the CLI is missing. A CLI error response is *returned* (`ok: false`), so the caller can show
 * the model or the user exactly what the CLI said.
 */
export async function runBaw(argv: readonly string[], options: { timeoutMs?: number } = {}): Promise<BawCallResult> {
	const full = argv.includes("--json") ? [...argv] : [...argv, "--json"];

	assertReadOnly(full); // before any process is created

	const started = Date.now();
	const timeoutMs = options.timeoutMs ?? defaultTimeoutMs();
	const { stdout, stderr, exitCode } = await execFileAsync(bawBin(), full, timeoutMs);
	const durationMs = Date.now() - started;

	const envelope = parseEnvelope(stdout);
	const ok = exitCode === 0 && envelope?.success !== false;

	await writeAudit({
		ts: new Date(started).toISOString(),
		cmd: auditShape(full),
		ok,
		exitCode,
		durationMs,
	});

	return {
		argv: full,
		ok,
		data: envelope?.data,
		raw: stdout.trim(),
		stderr: stderr.trim(),
		exitCode,
		durationMs,
	};
}
