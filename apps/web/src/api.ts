/**
 * The API client: one place that knows the server's wire format.
 *
 * Keep the `ClientEvent` union in sync with `ClientEvent` in apps/server/src/http/server.ts — that
 * is the only contract between the two apps.
 */

export type ApiOk = { ok: true; data: unknown };
export type ApiError = { ok: false; error: string; exitCode?: number };
export type ApiResult = ApiOk | ApiError;

export interface WalletSummary {
	status?: ApiResult;
	settings?: ApiResult;
	balances?: ApiResult;
}

export interface WalletPolicyState {
	phase: number;
	mode: string;
	allowlistedCommands: number;
}

export interface AgentState {
	model: string;
	cwd: string;
	shell: boolean;
	busy: boolean;
	skills: string[];
	skillDiagnostics: string[];
	walletPolicy: WalletPolicyState;
	tools: string[];
}

export type ClientEvent =
	| { type: "delta"; text: string }
	| { type: "tool_start"; name: string }
	| { type: "tool_end"; name: string; isError: boolean }
	| { type: "busy"; busy: boolean }
	| { type: "settled" }
	| { type: "error"; message: string };

export async function fetchState(): Promise<AgentState | undefined> {
	try {
		return (await (await fetch("/api/state")).json()) as AgentState;
	} catch {
		return undefined;
	}
}

export async function fetchWalletSummary(): Promise<WalletSummary> {
	try {
		return (await (await fetch("/api/wallet/summary")).json()) as WalletSummary;
	} catch {
		return { status: { ok: false, error: "the agent server is not reachable" } };
	}
}

export async function sendPrompt(text: string): Promise<void> {
	await fetch("/api/prompt", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ text }),
	});
}

export async function abortAgent(): Promise<void> {
	await fetch("/api/abort", { method: "POST" });
}

/** Subscribes to the session event stream. Returns the unsubscribe function. */
export function openEventStream(onEvent: (event: ClientEvent) => void): () => void {
	const source = new EventSource("/api/events");
	source.onmessage = (message: MessageEvent<string>) => {
		onEvent(JSON.parse(message.data) as ClientEvent);
	};
	return () => source.close();
}
