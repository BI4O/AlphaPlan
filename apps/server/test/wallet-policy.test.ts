/**
 * Policy tests. These are the tests that matter for safety, and they need no network, no wallet
 * session, and no model — they are pure functions, so they run in milliseconds and can be required
 * to pass before any commit that touches src/wallet/policy.ts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	assertReadOnly,
	classifyBaw,
	commandPath,
	readOnlyCommandCount,
	WalletPolicyError,
} from "../src/wallet/policy.ts";

const ALLOWED: string[][] = [
	["wallet", "status"],
	["wallet", "settings"],
	["wallet", "balance"],
	["wallet", "balance", "--binanceChainId", "56", "--symbol", "USDT"],
	["wallet", "tx-history", "--type", "pending"],
	["wallet", "tx-lock", "--binanceChainId", "56"],
	["wallet", "gas-price", "--binanceChainId", "56"],
	["approvals", "list"],
	["approvals", "detail", "--tokenAddress", "0x55d398326f99059fF775485246999027B3197955"],
	["market-order", "quote", "--fromTokenQty", "1", "--fromToken", "0xa", "--toToken", "0xb", "--binanceChainId", "56"],
	["market-order", "list", "--status", "PENDING"],
	["limit-order", "list"],
	["prediction", "market", "list"],
	["prediction", "position", "settled-history"],
	["prediction", "position", "pnl"],
	["prediction", "trade", "quote"],
	["defi", "protocol-list", "--investType", "Earn"],
	["defi", "position"],
	["defi", "preview", "--action", "DEPOSIT"],
	["x402-payment", "preview", "--paymentRequirements", "{}"],
	["sign-message", "history"],
	["sign-message", "result", "--order-id", "msg-order-1"],
	["cli-check", "--required-version", "1.10.0"],
];

const DENIED: Array<[string[], string]> = [
	[["wallet", "send", "--amount", "1", "--recipient", "0x1"], "transfer"],
	[["wallet", "send", "--max", "--recipient", "0x1"], "transfer everything"],
	[["wallet", "speed-up", "--tx", "0x1"], "replace a pending transaction"],
	[["wallet", "cancel", "--tx", "0x1"], "cancel a pending transaction"],
	[["market-order", "swap", "--fromTokenQty", "1"], "swap"],
	[["limit-order", "buy", "--amount", "1"], "limit buy"],
	[["limit-order", "sell", "--amount", "1"], "limit sell"],
	[["limit-order", "cancel", "--orderId", "1"], "cancel a limit order"],
	[["prediction", "trade", "place-order"], "place a prediction"],
	[["prediction", "trade", "redeem"], "redeem a prediction"],
	[["defi", "deposit", "--amount", "1"], "stake into a protocol"],
	[["defi", "redeem", "--amount", "1"], "withdraw from a protocol"],
	[["defi", "lp-add", "--amount", "1"], "add liquidity"],
	[["defi", "lp-remove", "--ratio", "1"], "remove liquidity"],
	[["defi", "claim", "--claimType", "FEE"], "claim rewards"],
	[["x402-payment", "sign", "--requestId", "x"], "pay an x402 resource"],
	[["approvals", "revoke", "--tokenAddress", "0xa"], "revoke an approval"],
	[["contract-call", "preview", "--to", "0xa"], "external calldata, needs devMode"],
	[["contract-call", "execute", "--requestId", "x"], "external calldata"],
	[["sign-message", "preview", "--message", "0x"], "external signing, needs devMode"],
	[["sign-message", "execute", "--requestId", "x"], "external signing"],
	[["auth", "signin"], "session management is human-only"],
	[["auth", "signout"], "session management is human-only"],
	[["wallet", "frobnicate"], "a command that does not exist"],
	[["market-order"], "a group name alone"],
];

describe("classifyBaw: allowlist", () => {
	for (const argv of ALLOWED) {
		it(`allows baw ${argv.join(" ")}`, () => {
			const decision = classifyBaw(argv);
			assert.equal(decision.allowed, true, `expected allowed: ${JSON.stringify(decision)}`);
		});
	}
});

describe("classifyBaw: default deny", () => {
	for (const [argv, what] of DENIED) {
		it(`refuses ${what}: baw ${argv.join(" ")}`, () => {
			const decision = classifyBaw(argv);
			assert.equal(decision.allowed, false, `expected denied: ${argv.join(" ")}`);
			if (!decision.allowed) assert.ok(decision.reason.length > 0);
		});
	}
});

describe("classifyBaw: shapes that are not a command", () => {
	for (const argv of [[], ["--json"], ["-h"], [""]]) {
		it(`refuses ${JSON.stringify(argv)}`, () => {
			assert.equal(classifyBaw(argv).allowed, false);
		});
	}
});

describe("flag allowlist", () => {
	it("refuses a mutating flag smuggled into a read command", () => {
		const decision = classifyBaw(["wallet", "balance", "--max"]);
		assert.equal(decision.allowed, false);
		if (!decision.allowed) assert.match(decision.reason, /--max/);
	});

	it("accepts a flag written as --flag=value", () => {
		assert.equal(classifyBaw(["wallet", "balance", "--binanceChainId=56"]).allowed, true);
	});
});

describe("assertReadOnly", () => {
	it("is silent for a read-only command", () => {
		assert.doesNotThrow(() => assertReadOnly(["wallet", "balance", "--json"]));
	});

	it("throws a WalletPolicyError naming the refused command", () => {
		let caught: unknown;
		try {
			assertReadOnly(["wallet", "send", "--amount", "1"]);
		} catch (error) {
			caught = error;
		}
		assert.ok(caught instanceof WalletPolicyError, "expected a WalletPolicyError");
		assert.equal(caught.command, "wallet send");
		assert.match(caught.message, /wallet send/);
		assert.match(caught.message, /allowlist/);
	});
});

describe("commandPath", () => {
	it("stops at the first flag", () => {
		assert.deepEqual(commandPath(["wallet", "balance", "--symbol", "USDT"]), ["wallet", "balance"]);
	});

	it("keeps at most three tokens", () => {
		assert.deepEqual(commandPath(["prediction", "position", "settled-history", "extra"]), [
			"prediction",
			"position",
			"settled-history",
		]);
	});
});

describe("allowlist size is a review signal", () => {
	it("stays small enough to read in one screen", () => {
		assert.ok(readOnlyCommandCount() < 40, `allowlist grew to ${readOnlyCommandCount()} commands`);
	});
});
