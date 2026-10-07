/**
 * The local HTTP host: pi session events out over SSE, prompts in over POST, plus a wallet panel
 * endpoint that reads balances *without* involving the model.
 *
 * That last part is worth keeping deliberate: the panel data path calls `runBaw()` directly from a
 * route handler, so what the user sees on screen is never a model's summary of what it read.
 *
 * To add a route, add a branch in `handleApi` below. Everything is one process and one session in
 * phase 1; multi-session routing is a phase 2 concern.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { WalletAgent } from "../agent/session.ts";
import { runBaw } from "../wallet/cli.ts";
import { readOnlyCommandCount } from "../wallet/policy.ts";
import { serveStatic } from "./static.ts";

const MAX_BODY_BYTES = 256 * 1024;

export interface ServerOptions {
	agent: WalletAgent;
	port: number;
	host: string;
	webRoot: string;
}

export interface RunningServer {
	port: number;
	close(): Promise<void>;
}

/** The wire format the web app consumes. Keep in sync with apps/web/src/api.ts. */
type ClientEvent =
	| { type: "delta"; text: string }
	| { type: "tool_start"; name: string }
	| { type: "tool_end"; name: string; isError: boolean }
	| { type: "busy"; busy: boolean }
	| { type: "settled" }
	| { type: "error"; message: string };

function sendJson(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = chunk as Buffer;
		size += buffer.length;
		if (size > MAX_BODY_BYTES) throw new Error("request body too large");
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}

/** Narrow pi's session events down to the handful the UI needs. */
function toClientEvent(event: { type: string } & Record<string, unknown>): ClientEvent | undefined {
	switch (event.type) {
		case "message_update": {
			const inner = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
			if (inner?.type === "text_delta" && typeof inner.delta === "string") {
				return { type: "delta", text: inner.delta };
			}
			return undefined;
		}
		case "tool_execution_start":
			return { type: "tool_start", name: String(event.toolName) };
		case "tool_execution_end":
			return { type: "tool_end", name: String(event.toolName), isError: event.isError === true };
		case "agent_settled":
			return { type: "settled" };
		default:
			return undefined;
	}
}

const PLACEHOLDER = `<!doctype html>
<meta charset="utf-8">
<title>SuperBi4o agent</title>
<body style="font:15px/1.6 system-ui;max-width:44rem;margin:4rem auto;padding:0 1rem">
<h1>Agent server is running</h1>
<p>The web app has not been built yet. Either start the Vite dev server:</p>
<pre><code>pnpm dev:web</code></pre>
<p>or build it so this server can serve it:</p>
<pre><code>pnpm build:web</code></pre>
<p>API endpoints: <code>/api/state</code>, <code>/api/wallet/summary</code>,
<code>/api/events</code> (SSE), <code>POST /api/prompt</code>, <code>POST /api/abort</code>.</p>
</body>`;

export async function startServer(options: ServerOptions): Promise<RunningServer> {
	const { agent } = options;
	const clients = new Set<ServerResponse>();
	let busy = false;

	const broadcast = (event: ClientEvent): void => {
		const frame = `data: ${JSON.stringify(event)}\n\n`;
		for (const client of clients) client.write(frame);
	};

	agent.session.subscribe((event) => {
		const mapped = toClientEvent(event as { type: string } & Record<string, unknown>);
		if (mapped === undefined) return;
		if (mapped.type === "settled") {
			busy = false;
			broadcast({ type: "busy", busy: false });
		}
		broadcast(mapped);
	});

	const handleApi = async (request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean> => {
		if (pathname === "/api/health") {
			sendJson(response, 200, { ok: true });
			return true;
		}

		if (pathname === "/api/state" && request.method === "GET") {
			sendJson(response, 200, {
				model: agent.modelLabel,
				cwd: agent.cwd,
				shell: agent.shell,
				busy,
				skills: agent.skills,
				skillDiagnostics: agent.skillDiagnostics,
				walletPolicy: { phase: 1, mode: "read-only", allowlistedCommands: readOnlyCommandCount() },
				tools: agent.session.getActiveToolNames(),
			});
			return true;
		}

		// The panel reads the wallet in-process: no model, no prompt, no summarisation.
		if (pathname === "/api/wallet/summary" && request.method === "GET") {
			const wanted: Array<[string, string[]]> = [
				["status", ["wallet", "status"]],
				["settings", ["wallet", "settings"]],
				["balances", ["wallet", "balance"]],
			];
			const results = await Promise.all(
				wanted.map(async ([key, argv]) => {
					try {
						const result = await runBaw(argv);
						return [
							key,
							result.ok
								? { ok: true as const, data: result.data }
								: { ok: false as const, error: result.stderr || result.raw, exitCode: result.exitCode },
						] as const;
					} catch (error) {
						return [key, { ok: false as const, error: error instanceof Error ? error.message : String(error) }] as const;
					}
				}),
			);
			sendJson(response, 200, Object.fromEntries(results));
			return true;
		}

		if (pathname === "/api/events" && request.method === "GET") {
			response.writeHead(200, {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache, no-transform",
				connection: "keep-alive",
				"x-accel-buffering": "no",
			});
			response.write(": connected\n\n");
			response.write(`data: ${JSON.stringify({ type: "busy", busy })}\n\n`);
			clients.add(response);
			const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 15_000);
			request.on("close", () => {
				clearInterval(keepAlive);
				clients.delete(response);
			});
			return true;
		}

		if (pathname === "/api/prompt" && request.method === "POST") {
			let text: string;
			try {
				const parsed = JSON.parse(await readBody(request)) as { text?: unknown };
				text = typeof parsed.text === "string" ? parsed.text.trim() : "";
			} catch (error) {
				sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : "bad body" });
				return true;
			}
			if (text === "") {
				sendJson(response, 400, { ok: false, error: "text is required" });
				return true;
			}

			const wasBusy = busy;
			busy = true;
			broadcast({ type: "busy", busy: true });
			sendJson(response, 202, { ok: true, queued: wasBusy });

			// Queued input follows the running turn; a fresh run starts one. Both are safe to leave
			// pending because the response is already sent and output streams over SSE.
			void (wasBusy ? agent.session.followUp(text) : agent.session.prompt(text)).catch((error: unknown) => {
				broadcast({ type: "error", message: error instanceof Error ? error.message : String(error) });
			});
			return true;
		}

		if (pathname === "/api/abort" && request.method === "POST") {
			await agent.session.abort();
			sendJson(response, 200, { ok: true });
			return true;
		}

		return false;
	};

	const server = createServer((request, response) => {
		void (async () => {
			const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
			try {
				if (await handleApi(request, response, url.pathname)) return;
				if (await serveStatic(response, options.webRoot, url.pathname)) return;
				if (url.pathname === "/" || url.pathname === "/index.html") {
					response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
					response.end(PLACEHOLDER);
					return;
				}
				sendJson(response, 404, { ok: false, error: `no route for ${url.pathname}` });
			} catch (error) {
				if (!response.headersSent) {
					sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
				} else {
					response.end();
				}
			}
		})();
	});

	const port = await new Promise<number>((resolvePort, rejectPort) => {
		server.once("error", rejectPort);
		server.listen(options.port, options.host, () => {
			const address = server.address();
			resolvePort(typeof address === "object" && address !== null ? address.port : options.port);
		});
	});

	return {
		port,
		close: async () => {
			for (const client of clients) client.end();
			clients.clear();
			await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
		},
	};
}
