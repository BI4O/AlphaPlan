import type { AgentState, WalletSummary } from "../api.ts";
import { DataView } from "./DataView.tsx";

export function WalletPanel({
	wallet,
	state,
	onRefresh,
}: {
	wallet: WalletSummary | undefined;
	state: AgentState | undefined;
	onRefresh(): void;
}) {
	return (
		<aside className="wallet">
			<div className="panel-head">
				<h2>Wallet</h2>
				<button type="button" className="ghost" onClick={onRefresh}>
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

			{state !== undefined && (
				<>
					<h3>Skills</h3>
					<ul className="skills">
						{state.skills.length === 0 ? (
							<li className="muted">none</li>
						) : (
							state.skills.map((skill) => <li key={skill}>{skill}</li>)
						)}
					</ul>
					{state.skillDiagnostics.length > 0 && <pre className="error">{state.skillDiagnostics.join("\n")}</pre>}
				</>
			)}
		</aside>
	);
}
