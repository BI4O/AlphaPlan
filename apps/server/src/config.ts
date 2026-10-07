/**
 * Every environment variable is read here and nowhere else, so the whole configuration surface is
 * one file. The defaults are the cautious ones; the warnings explain what a flag gives up.
 */

import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, derived from this file's location (apps/server/src/config.ts). */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export interface AgentConfig {
	repoRoot: string;
	/** The agent's working directory. It can write here, so it must not be this repository. */
	cwd: string;
	sessionDir: string;
	model: string | undefined;
	/**
	 * Whether pi's shell tools are registered. `false` is the phase 1 boundary: with no shell there
	 * is no route to `baw` other than the wallet tools, which is what makes "read-only" structural.
	 */
	shell: boolean;
	includeWalletSkill: boolean;
	codemode: boolean;
	toolSearch: boolean;
	mcp: boolean;
	port: number;
	host: string;
	webRoot: string;
}

function text(name: string): string | undefined {
	const raw = process.env[name];
	return raw === undefined || raw === "" ? undefined : raw;
}

function bool(name: string, fallback: boolean): boolean {
	const raw = text(name);
	if (raw === undefined) return fallback;
	return !["0", "false", "off", "no"].includes(raw.toLowerCase());
}

function numberOf(name: string, fallback: number): number {
	const raw = text(name);
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isFinite(value)) throw new Error(`${name} must be a number, got "${raw}"`);
	return value;
}

export function loadConfig(): AgentConfig {
	const repoRoot = REPO_ROOT;
	const cwd = resolve(text("AGENT_CWD") ?? resolve(repoRoot, "workspace"));

	// A write-capable agent pointed at its own source turns a prompt injection into code execution
	// on the next start. Refuse rather than warn.
	const appSource = resolve(repoRoot, "apps", "server", "src");
	if (cwd === appSource || cwd.startsWith(appSource + sep)) {
		throw new Error(
			`AGENT_CWD (${cwd}) points at this server's own source. Choose a directory that only holds agent work.`,
		);
	}

	return {
		repoRoot,
		cwd,
		sessionDir: resolve(text("AGENT_SESSION_DIR") ?? resolve(repoRoot, "data", "sessions")),
		model: text("AGENT_MODEL"),
		shell: bool("AGENT_SHELL", false),
		includeWalletSkill: bool("AGENT_INCLUDE_WALLET_SKILL", false),
		codemode: bool("AGENT_CODEMODE", false),
		toolSearch: bool("AGENT_TOOL_SEARCH", false),
		mcp: bool("AGENT_MCP", false),
		port: numberOf("PORT", 8787),
		host: text("HOST") ?? "127.0.0.1",
		webRoot: resolve(text("WEB_ROOT") ?? resolve(repoRoot, "apps", "web", "dist")),
	};
}

/**
 * The trade-offs a flag gives up, as text, so `index.ts` can print them at startup. Warnings about
 * a weakened boundary are worth being loud about: they are invisible in the code otherwise.
 */
export function configWarnings(config: AgentConfig): string[] {
	const warnings: string[] = [];

	if (config.shell) {
		warnings.push(
			"AGENT_SHELL=on — the wallet guard for shell commands is string matching, which stops\n" +
				"        accidents and not an adversary. A shell-capable agent can reach `baw` with every\n" +
				"        command the CLI supports, including transfers, so the wallet boundary drops back to\n" +
				"        the Binance-side daily limits. That is the ceiling you are left with.",
		);
	}

	if (config.mcp || config.codemode) {
		warnings.push(
			"AGENT_MCP / AGENT_CODEMODE — these add tools this project does not police. `wallet/*`\n" +
				"        only guards pi's bash tool and the wallet_* tools; an MCP server that can run\n" +
				"        commands is a route around them. Enable only servers you trust, and prefer\n" +
				"        read-only ones.",
		);
	}

	if (config.includeWalletSkill) {
		warnings.push(
			"AGENT_INCLUDE_WALLET_SKILL=on — the skill's command routing table now reaches the model.\n" +
				"        Phase 1 refuses those commands in code, so this only costs context and invites\n" +
				"        failed attempts. It becomes useful when phase 2 adds gated mutations.",
		);
	}

	return warnings;
}
