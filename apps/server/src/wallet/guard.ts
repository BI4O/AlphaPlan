/**
 * The shell guard: keeps the model (and a human typing `!`) from reaching the wallet CLI by any
 * route other than the wallet tools.
 *
 * This is a *heuristic*, and it is deliberately over-eager: it matches the bare word `baw`, the npm
 * package name, and a path ending in `/baw`. It stops accidents — a model that decides to shell out
 * instead of using the tools — and it cannot stop an adversary, because string matching over shell
 * syntax is not sound (`eval "$(echo … | base64 -d)"` defeats it).
 *
 * That gap is why phase 1 removes the shell tool from the agent entirely (`AGENT_SHELL=off`, the
 * default) rather than relying on this module. Keep that in mind before adding a tool that can run
 * commands: every such tool is a hole in this guard.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WALLET_CLI_MENTION = /\bbaw\b|agentic-wallet/i;

/** True when a shell command string appears to reach the wallet CLI. Over-eager by design. */
export function mentionsWalletCli(command: string): boolean {
	return WALLET_CLI_MENTION.test(command);
}

export const SHELL_BLOCK_REASON =
	"Refused: the wallet CLI (`baw`) is never run through a shell in this session. " +
	"Use the wallet_* tools, which are read-only in phase 1. Wallet writes need the approval path, " +
	"which is not built yet — if the user asks for a transfer or a trade, say so instead of working around it.";

/**
 * Installs both guards: `tool_call` for the model's bash tool, `user_bash` for a human typing `!`.
 */
export function installWalletShellGuard(pi: ExtensionAPI): void {
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash" && event.toolName !== "powershell") return undefined;
		const command = (event.input as { command?: unknown }).command;
		if (typeof command !== "string" || !mentionsWalletCli(command)) return undefined;
		return { block: true, reason: SHELL_BLOCK_REASON };
	});

	pi.on("user_bash", async (event) => {
		if (!mentionsWalletCli(event.command)) return undefined;
		return {
			result: { output: SHELL_BLOCK_REASON, exitCode: 1, cancelled: false, truncated: false },
		};
	});
}
