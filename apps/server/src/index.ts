/**
 * Entry point. Everything configurable is an environment variable, listed in the README.
 *
 * The defaults are the cautious ones: no shell, read-only wallet, and a working directory that is
 * *not* this repository — a write-capable agent pointed at its own source is a way to turn a prompt
 * injection into code execution on the next start.
 */

import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import { createWalletAgent } from "./agent.ts";
import { startServer } from "./server.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function flag(name: string, fallback: boolean): boolean {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	return !["0", "false", "off", "no"].includes(raw.toLowerCase());
}

function requiredCwd(): string {
	const cwd = resolve(process.env.AGENT_CWD ?? resolve(repoRoot, "workspace"));
	const appSource = resolve(repoRoot, "apps", "server", "src");
	if (cwd === appSource || cwd.startsWith(appSource + sep)) {
		throw new Error(
			`AGENT_CWD (${cwd}) points at this server's own source. The agent can write files there, and ` +
				"anything it writes would run the next time the server starts. Choose a directory that only holds agent work.",
		);
	}
	return cwd;
}

const cwd = requiredCwd();
await mkdir(cwd, { recursive: true });

const shell = flag("AGENT_SHELL", false);
if (shell) {
	console.warn(
		"[agent] AGENT_SHELL=on: the agent can run arbitrary shell commands. The wallet guard for the\n" +
			"        shell is string matching, which stops accidents and not an adversary — a shell-capable\n" +
			"        agent can reach `baw` with any command the CLI supports, including transfers. Raise the\n" +
			"        server-side daily limits in the Binance App only if you accept that.",
	);
}

const agent = await createWalletAgent({
	cwd,
	sessionDir: resolve(process.env.AGENT_SESSION_DIR ?? resolve(repoRoot, "data", "sessions")),
	model: process.env.AGENT_MODEL,
	shell,
	includeWalletSkill: flag("AGENT_INCLUDE_WALLET_SKILL", false),
});

const webRootEnv = process.env.WEB_ROOT;
const webRoot = webRootEnv === undefined || webRootEnv === "" ? resolve(repoRoot, "apps", "web", "dist") : resolve(webRootEnv);

const server = await startServer({
	agent,
	port: Number(process.env.PORT ?? 8787),
	host: process.env.HOST ?? "127.0.0.1",
	webRoot,
});

console.log(`[agent] model      ${agent.modelLabel}`);
console.log(`[agent] cwd        ${agent.cwd}`);
console.log(`[agent] shell      ${agent.shell ? "on (wallet guard is heuristic)" : "off (bash tool excluded)"}`);
console.log(`[agent] skills     ${agent.skills.length === 0 ? "(none)" : agent.skills.join(", ")}`);
console.log(`[agent] listening  http://${process.env.HOST ?? "127.0.0.1"}:${server.port}`);

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`\n[agent] ${signal}: shutting down`);
	await server.close();
	agent.dispose();
	process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
