import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SERVER_ENV = fileURLToPath(new URL("../server/.env", import.meta.url));

/**
 * The agent server is a separate process; every /api request is proxied to it in dev.
 *
 * The port is read from `apps/server/.env` when `AGENT_ORIGIN` is not set, because a proxy that
 * silently points at the wrong port costs an hour of confusion the first time you move the server.
 * Precedence: `AGENT_ORIGIN` > `PORT` in apps/server/.env > 8787.
 */
function agentOrigin(): string {
	if (process.env.AGENT_ORIGIN !== undefined && process.env.AGENT_ORIGIN !== "") return process.env.AGENT_ORIGIN;

	let port = "8787";
	try {
		const match = /^PORT=(.+)$/m.exec(readFileSync(SERVER_ENV, "utf8"));
		if (match?.[1] !== undefined && match[1].trim() !== "") port = match[1].trim();
	} catch {
		// No .env: fall back to the server's own default.
	}
	return `http://127.0.0.1:${port}`;
}

const target = agentOrigin();

export default defineConfig({
	plugins: [react()],
	server: {
		port: Number(process.env.WEB_PORT ?? 5173),
		proxy: {
			"/api": { target, changeOrigin: true, ws: false },
		},
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
});
