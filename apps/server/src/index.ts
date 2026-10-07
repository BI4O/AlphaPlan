/**
 * Entry point: configuration → agent → HTTP.
 *
 * Nothing else lives here. If you are looking for behaviour, the map is:
 *   config.ts            every environment variable
 *   agent/extensions.ts  ★ what the agent can do (add new domains here)
 *   agent/session.ts     how the pi session is assembled
 *   wallet/              the wallet domain: policy, CLI chokepoint, tools, shell guard
 *   http/server.ts       routes and SSE
 *   dev/selftest.ts      `pnpm selftest`
 */

import { mkdir } from "node:fs/promises";
// config.ts first, on purpose: it loads `.env` as an import side effect.
import { configWarnings, loadConfig } from "./config.ts";
import { createWalletAgent } from "./agent/session.ts";
import { startServer } from "./http/server.ts";

const config = loadConfig();
await mkdir(config.cwd, { recursive: true });

for (const warning of configWarnings(config)) console.warn(`[agent] ${warning}`);

const agent = await createWalletAgent(config);
const server = await startServer({ agent, port: config.port, host: config.host, webRoot: config.webRoot });

console.log(`[agent] model      ${agent.modelLabel}`);
console.log(`[agent] cwd        ${agent.cwd}`);
console.log(`[agent] shell      ${agent.shell ? "on (wallet guard is heuristic)" : "off (bash tool excluded)"}`);
console.log(`[agent] skills     ${agent.skills.length === 0 ? "(none)" : agent.skills.join(", ")}`);
for (const diagnostic of agent.skillDiagnostics) console.warn(`[agent] skill      ${diagnostic}`);
console.log(`[agent] listening  http://${config.host}:${server.port}`);

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
