import { useCallback, useEffect, useState } from "react";
import { fetchState, fetchWalletSummary, type AgentState, type WalletSummary } from "./api.ts";
import { Chat } from "./components/Chat.tsx";
import { WalletPanel } from "./components/WalletPanel.tsx";
import { useAgent } from "./hooks/useAgent.ts";

export function App() {
	const chat = useAgent();
	const [state, setState] = useState<AgentState | undefined>();
	const [wallet, setWallet] = useState<WalletSummary | undefined>();

	const refreshWallet = useCallback(() => {
		void fetchWalletSummary().then(setWallet);
	}, []);

	useEffect(() => {
		void fetchState().then(setState);
		refreshWallet();
	}, [refreshWallet]);

	return (
		<div className="app">
			<header className="top">
				<div>
					<strong>SuperBi4o agent</strong>
					<span className="badge phase">
						phase {state?.walletPolicy.phase ?? "?"} · {state?.walletPolicy.mode ?? "read-only"}
					</span>
					<span className={"badge " + (state?.shell === true ? "warn" : "safe")}>
						shell {state?.shell === true ? "on" : "off"}
					</span>
				</div>
				<div className="muted small">
					{state?.model ?? "…"} · {state?.cwd ?? "…"} · {state?.walletPolicy.allowlistedCommands ?? "?"} allowlisted
					commands
				</div>
			</header>

			<main>
				<Chat chat={chat} />
				<WalletPanel wallet={wallet} state={state} onRefresh={refreshWallet} />
			</main>
		</div>
	);
}
