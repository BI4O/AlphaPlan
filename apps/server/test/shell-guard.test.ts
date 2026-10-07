/**
 * Shell guard tests. The guard is a heuristic — these tests pin down *which* heuristic, so that
 * nobody mistakes it for a boundary. See src/wallet/guard.ts for why the shell tool is removed in
 * phase 1 instead of being trusted to this.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mentionsWalletCli } from "../src/wallet/guard.ts";

describe("shell mention detection", () => {
	it("flags direct, absolute, and nested invocations", () => {
		assert.equal(mentionsWalletCli("baw wallet balance"), true);
		assert.equal(mentionsWalletCli("~/bin/baw market-order swap --x 1"), true);
		assert.equal(mentionsWalletCli('sh -c "baw wallet send --max"'), true);
		assert.equal(mentionsWalletCli("echo hi | xargs baw"), true);
		assert.equal(mentionsWalletCli("pnpm add -g @binance/agentic-wallet"), true);
	});

	it("leaves unrelated commands alone", () => {
		assert.equal(mentionsWalletCli("ls -la"), false);
		assert.equal(mentionsWalletCli("git status"), false);
		assert.equal(mentionsWalletCli("grep -rn wallet src/"), false);
	});

	it("does not match a word that merely contains the letters", () => {
		assert.equal(mentionsWalletCli("cat mybawfile.txt"), false);
	});

	it("is deliberately over-eager: a command that merely mentions the word is blocked too", () => {
		// Documented and accepted: over-blocking is the safe direction, and the cost is a retry.
		assert.equal(mentionsWalletCli("echo baw"), true);
	});

	it("documents its own blind spot", () => {
		// This is the reason the shell tool is removed rather than guarded. If this assertion ever
		// starts failing, the guard got better — the README's reasoning would need revisiting too.
		assert.equal(mentionsWalletCli('eval "$(echo YmF3IHdhbGxldCBzZW5kIC0tbWF4 | base64 -d)"'), false);
	});
});
