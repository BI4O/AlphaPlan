/**
 * Renders whatever the wallet CLI returned, without inventing field names we have not verified.
 *
 * The CLI's shapes differ per command (a list of balances, a settings object, an error envelope),
 * so this detects the shape and renders it. When a command's shape becomes stable and important,
 * promote it to its own component rather than adding special cases here.
 */

import type { ApiResult } from "../api.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalar(value: unknown): string {
	if (value === null || value === undefined) return "—";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

export function DataView({ result }: { result: ApiResult | undefined }) {
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
