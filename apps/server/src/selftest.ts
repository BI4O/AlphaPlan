/**
 * Self-test: prove the wiring, without a model call.
 *
 * Run this after a change to the policy, the tools, or the CLI version. It checks, in order:
 *   1. the policy decisions (the same table the unit tests cover, condensed)
 *   2. the shell guard
 *   3. the wallet CLI: present? pinned? connected?
 *   4. the pi session: extensions load, the wallet skill is filtered, `bash` is absent
 *
 * Nothing here needs an API key, and nothing here moves funds — the whole point of phase 1.
 */

import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { BawNotInstalledError, runBaw } from "./baw.ts";
import { classifyBaw, mentionsWalletCli, readOnlyCommandCount } from "./policy.ts";
import { WALLET_TOOL_NAMES } from "./wallet-tools.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

let failures = 0;
let warnings = 0;

function pass(label: string): void {
	console.log(`  ok    ${label}`);
}

function fail(label: string, detail: string): void {
	failures += 1;
	console.log(`  FAIL  ${label}\n        ${detail}`);
}

function warn(label: string, detail: string): void {
	warnings += 1;
	console.log(`  warn  ${label}\n        ${detail}`);
}

function expect(label: string, actual: boolean, detail = ""): void {
	if (actual) pass(label);
	else fail(label, detail);
}

console.log("\n[1] policy: read-only allowlist");
{
	expect(`allowlist holds ${readOnlyCommandCount()} commands`, readOnlyCommandCount() > 0 && readOnlyCommandCount() < 40);

	const allowed: string[][] = [
		["wallet", "status"],
		["wallet", "balance", "--binanceChainId", "56"],
		["market-order", "quote", "--fromTokenQty", "1", "--fromToken", "0xa", "--toToken", "0xb", "--binanceChainId", "56"],
		["defi", "position"],
	];
	for (const argv of allowed) {
		expect(`allows baw ${argv.join(" ")}`, classifyBaw(argv).allowed);
	}

	const denied: string[][] = [
		["wallet", "send", "--amount", "1", "--recipient", "0x1"],
		["wallet", "send", "--max"],
		["market-order", "swap", "--fromTokenQty", "1"],
		["limit-order", "sell"],
		["defi", "deposit"],
		["defi", "redeem"],
		["defi", "claim"],
		["x402-payment", "sign"],
		["approvals", "revoke"],
		["contract-call", "execute", "--requestId", "x"],
		["sign-message", "execute", "--requestId", "x"],
		["auth", "signin"],
		["wallet", "balance", "--max"],
		["wallet", "invented-command"],
	];
	for (const argv of denied) {
		expect(`refuses baw ${argv.join(" ")}`, !classifyBaw(argv).allowed);
	}
}

console.log("\n[2] policy: shell guard");
{
	expect("flags `baw ...` in a command string", mentionsWalletCli("baw wallet balance"));
	expect("flags an absolute path", mentionsWalletCli("/Users/x/bin/baw wallet balance"));
	expect("flags the npm package name", mentionsWalletCli("npx @binance/agentic-wallet"));
	expect("ignores unrelated commands", !mentionsWalletCli("git status"));
}

console.log("\n[3] wallet CLI");
{
	let cliUsable = false;
	try {
		const status = await runBaw(["wallet", "status"]);
		cliUsable = true;
		if (status.ok) {
			const data = status.data as { status?: unknown } | undefined;
			pass(`baw responds (wallet status: ${String(data?.status ?? "unknown")})`);
		} else {
			warn("baw is installed but the call did not succeed", (status.stderr || status.raw).split("\n")[0] ?? "");
		}
	} catch (error) {
		if (error instanceof BawNotInstalledError) fail("baw is installed", error.message);
		else fail("baw wallet status runs", error instanceof Error ? error.message : String(error));
	}

	if (cliUsable) {
		const settings = await runBaw(["wallet", "settings"]);
		if (settings.ok) {
			const data = settings.data as Record<string, unknown> | undefined;
			const expiry = data?.["sessionExpireTime"];
			pass(`session expires ${String(expiry ?? "unknown")} (sign-out is silent — surface this in the UI)`);
		} else {
			warn("could not read wallet settings", (settings.stderr || settings.raw).split("\n")[0] ?? "");
		}
	}
}

console.log("\n[4] pi session");
{
	const cwd = resolve(process.env.AGENT_CWD ?? resolve(repoRoot, "workspace"));
	await mkdir(cwd, { recursive: true });

	try {
		const { createWalletAgent } = await import("./agent.ts");
		const agent = await createWalletAgent({
			cwd,
			sessionDir: resolve(repoRoot, "data", "sessions"),
			model: process.env.AGENT_MODEL,
			shell: false,
			includeWalletSkill: false,
		});
		try {
			const tools = agent.session.getActiveToolNames();
			for (const name of WALLET_TOOL_NAMES) {
				expect(`tool ${name} is active`, tools.includes(name));
			}
			expect("bash is excluded (shell off)", !tools.includes("bash"));
			expect("the wallet skill is filtered out", !agent.skills.includes("binance-agentic-wallet"));
			pass(`model resolved to ${agent.modelLabel}`);
			if (agent.skills.length > 0) pass(`other skills still loaded: ${agent.skills.join(", ")}`);
		} finally {
			agent.dispose();
		}
	} catch (error) {
		fail("the agent session builds", error instanceof Error ? error.message : String(error));
	}
}

console.log(
	`\n${failures === 0 ? "PASS" : "FAIL"}: ${failures} failure(s), ${warnings} warning(s). ` +
		"Warnings are expected while the wallet session is not connected.\n",
);

process.exit(failures === 0 ? 0 : 1);
