/**
 * The agent's wallet surface: nine read-only tools.
 *
 * Every tool is a thin, fixed-argv wrapper. The model supplies *values*, never a command: there is
 * no way to express `market-order swap` through these schemas, and `runBaw()` in ./cli.ts would
 * refuse it even if there were. The tool set is the phase 1 boundary; widening it is a code change
 * with a review, not a prompt the model might be talked out of.
 *
 * To add a capability, add a tool here and the matching command to ./policy.ts — never one without
 * the other. A tool whose command is not allowlisted fails at runtime, which is the intended
 * direction for the mismatch to fail in.
 */

import { Type } from "typebox";
import { defineTool, type AgentToolResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runBaw, type BawCallResult } from "./cli.ts";

/** Model-facing results are truncated; the model is told how to narrow the query instead. */
const MAX_MODEL_CHARS = 20_000;

const CHAIN_ID = "Binance chain ID. `56` = BSC, `CT_501` = Solana. Use wallet_chains for the full list.";

function truncate(text: string): string {
	if (text.length <= MAX_MODEL_CHARS) return text;
	const rest = text.length - MAX_MODEL_CHARS;
	return `${text.slice(0, MAX_MODEL_CHARS)}\n\n[truncated ${rest} characters — narrow the query (chain, symbol, time window) to see the rest]`;
}

function toResult(result: BawCallResult): AgentToolResult<Record<string, unknown>> {
	const details: Record<string, unknown> = {
		command: result.argv.join(" "),
		ok: result.ok,
		exitCode: result.exitCode,
		durationMs: result.durationMs,
	};

	if (result.ok) {
		return { content: [{ type: "text", text: truncate(JSON.stringify(result.data ?? null, null, 2)) }], details };
	}

	// The CLI is the source of truth for why something failed. Relay it verbatim; do not soften it.
	const parts = [`\`baw\` exited with code ${result.exitCode ?? "unknown"}.`];
	if (result.stderr !== "") parts.push(`stderr:\n${result.stderr}`);
	if (result.raw !== "") parts.push(`stdout:\n${result.raw}`);
	return { content: [{ type: "text", text: truncate(parts.join("\n\n")) }], details, isError: true };
}

/** Flattens optional flag/value pairs, skipping the ones that are unset. */
function argv(parts: ReadonlyArray<string | undefined>): string[] {
	const out: string[] = [];
	for (const part of parts) {
		if (part !== undefined && part !== "") out.push(part);
	}
	return out;
}

const walletStatus = defineTool({
	name: "wallet_status",
	label: "Wallet status",
	description: "Whether the Binance Agentic Wallet session is connected on this device.",
	promptSnippet: "Check whether the wallet session is connected",
	parameters: Type.Object({}),
	async execute() {
		return toResult(await runBaw(["wallet", "status"]));
	},
});

const walletSettings = defineTool({
	name: "wallet_settings",
	label: "Wallet settings",
	description:
		"The wallet's security settings: server-side daily limits and remaining quota, developer-mode " +
		"quota, and when the current session expires. Read-only — settings can only be changed in the Binance App.",
	promptSnippet: "Read daily limits, remaining quota, and session expiry",
	parameters: Type.Object({}),
	async execute() {
		return toResult(await runBaw(["wallet", "settings"]));
	},
});

const walletChains = defineTool({
	name: "wallet_chains",
	label: "Wallet chains",
	description: "List the chains this wallet supports, with their Binance chain IDs.",
	promptSnippet: "List supported chains and their chain IDs",
	parameters: Type.Object({}),
	async execute() {
		return toResult(await runBaw(["wallet", "chains"]));
	},
});

const walletBalance = defineTool({
	name: "wallet_balance",
	label: "Wallet balance",
	description: "Token balances, optionally narrowed to one chain, symbol, or token contract address.",
	promptSnippet: "Read token balances",
	parameters: Type.Object({
		binanceChainId: Type.Optional(Type.String({ description: CHAIN_ID })),
		symbol: Type.Optional(Type.String({ description: "Token symbol, e.g. USDT" })),
		tokenAddress: Type.Optional(Type.String({ description: "Token contract address" })),
	}),
	async execute(_id, params) {
		return toResult(
			await runBaw(
				argv([
					"wallet",
					"balance",
					params.binanceChainId === undefined ? undefined : "--binanceChainId",
					params.binanceChainId,
					params.symbol === undefined ? undefined : "--symbol",
					params.symbol,
					params.tokenAddress === undefined ? undefined : "--tokenAddress",
					params.tokenAddress,
				]),
			),
		);
	},
});

const walletTxHistory = defineTool({
	name: "wallet_tx_history",
	label: "Transaction history",
	description:
		'Transaction history. Use `type: "pending"` to find transactions that are still in flight — ' +
		"that is also what a reconciliation after a restart starts from.",
	promptSnippet: "Read transaction history, including pending transactions",
	parameters: Type.Object({
		type: Type.Optional(Type.String({ description: 'Filter by type, e.g. "pending"' })),
		size: Type.Optional(Type.Number({ description: "How many records to return" })),
		binanceChainId: Type.Optional(Type.String({ description: CHAIN_ID })),
	}),
	async execute(_id, params) {
		return toResult(
			await runBaw(
				argv([
					"wallet",
					"tx-history",
					params.type === undefined ? undefined : "--type",
					params.type,
					params.size === undefined ? undefined : "--size",
					params.size === undefined ? undefined : String(params.size),
					params.binanceChainId === undefined ? undefined : "--binanceChainId",
					params.binanceChainId,
				]),
			),
		);
	},
});

const walletTxLock = defineTool({
	name: "wallet_tx_lock",
	label: "Transaction lock",
	description:
		"Whether the chain has a pending transaction or a double-confirmation request waiting in the " +
		"Binance App. LOCKED blocks any new transaction and is a normal state to report, not an error.",
	promptSnippet: "Check for pending transactions and double-confirmation locks",
	parameters: Type.Object({
		binanceChainId: Type.String({ description: CHAIN_ID }),
	}),
	async execute(_id, params) {
		return toResult(await runBaw(["wallet", "tx-lock", "--binanceChainId", params.binanceChainId]));
	},
});

const walletGasPrice = defineTool({
	name: "wallet_gas_price",
	label: "Gas price",
	description: "Current gas price and fee levels for one chain.",
	promptSnippet: "Read gas price and fee levels",
	parameters: Type.Object({
		binanceChainId: Type.String({ description: CHAIN_ID }),
	}),
	async execute(_id, params) {
		return toResult(await runBaw(["wallet", "gas-price", "--binanceChainId", params.binanceChainId]));
	},
});

const walletQuote = defineTool({
	name: "wallet_quote",
	label: "Swap quote",
	description:
		"A DEX swap quote. This does not trade and does not place an order; it reports what a swap would " +
		"return right now. Phase 1 cannot execute one.",
	promptSnippet: "Get a swap quote without trading",
	parameters: Type.Object({
		fromTokenQty: Type.String({ description: "How much of fromToken to sell, in human-readable units" }),
		fromToken: Type.String({ description: "Contract address of the token being sold" }),
		toToken: Type.String({ description: "Contract address of the token being bought" }),
		binanceChainId: Type.String({ description: CHAIN_ID }),
		slippage: Type.Optional(Type.Number({ description: "Slippage tolerance in percent" })),
	}),
	async execute(_id, params) {
		return toResult(
			await runBaw(
				argv([
					"market-order",
					"quote",
					"--fromTokenQty",
					params.fromTokenQty,
					"--fromToken",
					params.fromToken,
					"--toToken",
					params.toToken,
					"--binanceChainId",
					params.binanceChainId,
					params.slippage === undefined ? undefined : "--slippage",
					params.slippage === undefined ? undefined : String(params.slippage),
				]),
			),
		);
	},
});

const walletDefiPositions = defineTool({
	name: "wallet_defi_positions",
	label: "DeFi positions",
	description:
		"Existing DeFi positions: lending health, liquidity pools, staking. Reports positions only — " +
		"phase 1 cannot deposit, redeem, or claim.",
	promptSnippet: "Read DeFi positions (lending health, LP, staking)",
	parameters: Type.Object({
		binanceChainId: Type.Optional(Type.String({ description: CHAIN_ID })),
		defiProtocolId: Type.Optional(Type.String({ description: "Narrow to one protocol" })),
	}),
	async execute(_id, params) {
		return toResult(
			await runBaw(
				argv([
					"defi",
					"position",
					params.binanceChainId === undefined ? undefined : "--binanceChainId",
					params.binanceChainId,
					params.defiProtocolId === undefined ? undefined : "--defiProtocolId",
					params.defiProtocolId,
				]),
			),
		);
	},
});

export const WALLET_TOOL_NAMES = [
	"wallet_status",
	"wallet_settings",
	"wallet_chains",
	"wallet_balance",
	"wallet_tx_history",
	"wallet_tx_lock",
	"wallet_gas_price",
	"wallet_quote",
	"wallet_defi_positions",
] as const;

export function registerWalletTools(pi: ExtensionAPI): void {
	pi.registerTool(walletStatus);
	pi.registerTool(walletSettings);
	pi.registerTool(walletChains);
	pi.registerTool(walletBalance);
	pi.registerTool(walletTxHistory);
	pi.registerTool(walletTxLock);
	pi.registerTool(walletGasPrice);
	pi.registerTool(walletQuote);
	pi.registerTool(walletDefiPositions);
}
