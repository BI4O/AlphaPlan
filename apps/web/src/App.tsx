import { useCallback, useEffect, useRef, useState } from "react";

type ApiOk = { ok: true; data: unknown };
type ApiError = { ok: false; error: string; exitCode?: number };
type ApiResult = ApiOk | ApiError;

interface WalletSummary {
	status?: ApiResult;
	settings?: ApiResult;
	balances?: ApiResult;
}

interface AgentState {
	model: string;
	cwd: string;
	shell: boolean;
	busy: boolean;
	skills: string[];
	skillDiagnostics: string[];
	walletPolicy: { phase: number; mode: string; allowlistedCommands: number };
	tools: string[];
}

interface Message {
	role: "user" | "assistant";
	text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalar(value: unknown): string {
	if (value === null || value === undefined) return "—";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

/** Render whatever the CLI returned without inventing field names we have not verified. */
function DataView({ result }: { result: ApiResult | undefined }) {
	if (result === undefined) return <p className="muted">no data</p>;
	if (!result.ok) {
		return (
			<div className="error">
				<strong>CLI error{result.exitCode === undefined ? "" : ` (exit ${result.exitCode})`}</strong>
				<pre>{result.error}</pre>
			</div>
		);
	}

	const { data } = result;
	if (Array.isArray(data)) {
		const rows = data.filter(isRecord);
		if (rows.length === 0) return <p className="muted">empty</p>;
		const columns = Object.keys(rows[0] ?? {}).slice(0, 6);
		return (
			<div className="scroll">
				<table>
					<thead>
						<tr>
							{columns.map((column) => (
								<th key={column}>{column}</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.slice(0, 40).map((row, index) => (
							<tr key={index}>
								{columns.map((column) => (
									<td key={column}>{scalar(row[column])}</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}

	if (isRecord(data)) {
		return (
			<dl className="kv">
				{Object.entries(data).map(([key, value]) => (
					<div key={key}>
						<dt>{key}</dt>
						<dd>{scalar(value)}</dd>
					</div>
				))}
			</dl>
		);
	}

	return <p className="muted">{scalar(data)}</p>;
}

export function App() {
	const [state, setState] = useState<AgentState | null>(null);
	const [wallet, setWallet] = useState<WalletSummary | null>(null);
	const [messages, setMessages] = useState<Message[]>([]);
	const [tools, setTools] = useState<string[]>([]);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const streamRef = useRef<HTMLSpanElement | null>(null);

	const refreshWallet = useCallback(async () => {
		try {
			const response = await fetch("/api/wallet/summary");
			setWallet((await response.json()) as WalletSummary);
		} catch {
			setWallet({ status: { ok: false, error: "the agent server is not reachable" } });
		}
	}, []);

	useEffect(() => {
		void (async () => {
			try {
				setState((await (await fetch("/api/state")).json()) as AgentState);
			} catch {
				setState(null);
			}
		})();
		void refreshWallet();
	}, [refreshWallet]);

	useEffect(() => {
		const source = new EventSource("/api/events");

		source.onmessage = (event: MessageEvent<string>) => {
			const payload = JSON.parse(event.data) as { type: string; text?: string; name?: string; isError?: boolean; busy?: boolean; message?: string };
			switch (payload.type) {
				case "delta":
					setMessages((current) => {
						const last = current.at(-1);
						if (last?.role === "assistant") {
							return [...current.slice(0, -1), { role: "assistant", text: last.text + (payload.text ?? "") }];
						}
						return [...current, { role: "assistant", text: payload.text ?? "" }];
					});
					break;
				case "tool_start":
					setTools((current) => [...current, payload.name ?? "?"]);
					break;
				case "tool_end":
					setTools((current) => [...current, `${payload.name ?? "?"} ${payload.isError === true ? "failed" : "done"}`]);
					break;
				case "busy":
					setBusy(payload.busy === true);
					break;
				case "settled":
					setBusy(false);
					break;
				case "error":
					setMessages((current) => [...current, { role: "assistant", text: `error: ${payload.message ?? "unknown"}` }]);
					break;
			}
		};

		return () => source.close();
	}, []);

	useEffect(() => {
		streamRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, tools]);

	const send = useCallback(async () => {
		const text = draft.trim();
		if (text === "") return;
		setDraft("");
		setMessages((current) => [...current, { role: "user", text }]);
		await fetch("/api/prompt", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text }),
		});
	}, [draft]);

	const abort = useCallback(async () => {
		await fetch("/api/abort", { method: "POST" });
	}, []);

	return (
		<div className="app">
			<header className="top">
				<div>
					<strong>SuperBi4o agent</strong>
					<span className="badge phase">phase {state?.walletPolicy.phase ?? "?"} · {state?.walletPolicy.mode ?? "read-only"}</span>
					<span className={"badge " + (state?.shell === true ? "warn" : "safe")}>
						shell {state?.shell === true ? "on" : "off"}
					</span>
				</div>
				<div className="muted small">
					{state?.model ?? "…"} · {state?.cwd ?? "…"} · {state?.walletPolicy.allowlistedCommands ?? "?"} allowlisted commands
				</div>
			</header>

			<main>
				<section className="chat">
					<div className="messages">
						{messages.length === 0 && (
							<p className="muted">
								Ask about balances, quotes, transaction history, DeFi positions. This session cannot move funds.
							</p>
						)}
						{messages.map((message, index) => (
							<div key={index} className={"msg " + message.role}>
								<pre>{message.text}</pre>
							</div>
						))}
						{tools.length > 0 && (
							<div className="tools">
								{tools.map((tool, index) => (
									<span key={index} className="chip">
										{tool}
									</span>
								))}
							</div>
						)}
						<span ref={streamRef} />
					</div>

					<form
						className="composer"
						onSubmit={(event) => {
							event.preventDefault();
							void send();
						}}
					>
						<textarea
							value={draft}
							placeholder={busy ? "the agent is working — this message will be queued" : "问点什么…"}
							onChange={(event) => setDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									void send();
								}
							}}
						/>
						<div className="composer-actions">
							<button type="submit" disabled={busy || draft.trim() === ""}>
								{busy ? "排队" : "发送"}
							</button>
							{busy && (
								<button type="button" className="ghost" onClick={() => void abort()}>
									停止
								</button>
							)}
						</div>
					</form>
				</section>

				<aside className="wallet">
					<div className="panel-head">
						<h2>Wallet</h2>
						<button type="button" className="ghost" onClick={() => void refreshWallet()}>
							刷新
						</button>
					</div>
					<p className="muted small">
						Read straight from the CLI, without the model. Session sign-out is silent — check expiry below.
					</p>

					<h3>Status</h3>
					<DataView result={wallet?.status} />
					<h3>Settings &amp; quota</h3>
					<DataView result={wallet?.settings} />
					<h3>Balances</h3>
					<DataView result={wallet?.balances} />

					{state !== null && (
						<>
							<h3>Skills</h3>
							<ul className="skills">
								{state.skills.length === 0 ? <li className="muted">none</li> : state.skills.map((skill) => <li key={skill}>{skill}</li>)}
							</ul>
							{state.skillDiagnostics.length > 0 && <pre className="error">{state.skillDiagnostics.join("\n")}</pre>}
						</>
					)}
				</aside>
			</main>
		</div>
	);
}
