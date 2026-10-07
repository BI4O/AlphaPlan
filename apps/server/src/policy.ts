/**
 * Wallet policy — the single authority on what the `baw` CLI may be asked to do.
 *
 * Why this file exists: the `binance-agentic-wallet` skill is a *document*. Its
 * "confirm before execution" rules are prose the model is asked to obey, while the very same
 * context carries strings an attacker can influence (token symbols, on-chain metadata — the
 * skill itself warns about this). This file is that policy expressed as code, and it is the only
 * part of it that is actually enforced.
 *
 * Invariants
 *  1. Every `baw` process in this project is spawned by `runBaw()` in ./baw.ts, which calls
 *     `assertReadOnly()` before the process exists. Nothing else may spawn the CLI, and nothing
 *     may run it through a shell (`mentionsWalletCli()` is what the shell guard uses).
 *  2. `classifyBaw()` is default-deny. A command that is not listed below is refused — including
 *     commands that do not exist yet.
 *  3. Phase 1 is read-only. Later phases add tiers *beside* this list; they must not soften this
 *     list into "anything that is not obviously dangerous".
 *
 * Not covered here (deliberately, see README):
 *  - `baw auth ...` is session management, not a wallet query. It stays human-only and outside
 *    the agent. When the session expires the agent reports it; it cannot sign itself back in.
 *  - `contract-call preview` / `sign-message preview` are not read-only in spirit: they need
 *    `devMode: true` and mint a signable request. Phase 1 refuses all of `contract-call` and all
 *    of `sign-message` except the pure history/result queries.
 */

/**
 * Command paths (`baw <tokens...>`) that only read state. Flags are appended after these tokens
 * and are validated separately against {@link ALLOWED_FLAGS}.
 */
const READ_ONLY_COMMANDS = [
  // wallet and session view
  "wallet status",
  "wallet chains",
  "wallet address",
  "wallet balance",
  "wallet tx-history",
  "wallet gas-price",
  "wallet settings",
  "wallet tx-lock",
  // approvals
  "approvals list",
  "approvals detail",
  // market orders (read side)
  "market-order quote",
  "market-order list",
  // limit orders (read side)
  "limit-order list",
  // prediction market (read side)
  "prediction category list",
  "prediction market list",
  "prediction market detail",
  "prediction market search",
  "prediction market order-book",
  "prediction market last-trade-price",
  "prediction position list",
  "prediction position token",
  "prediction position settled-history",
  "prediction position pnl",
  "prediction position portfolio",
  "prediction order history",
  "prediction trade quote",
  // DeFi (read side; `defi preview` builds a transaction without broadcasting it)
  "defi protocol-list",
  "defi protocol-info",
  "defi investment-list",
  "defi investment-info",
  "defi position",
  "defi preview",
  // x402 (preview only — `x402-payment sign` is refused)
  "x402-payment preview",
  // external signing (read side only)
  "sign-message result",
  "sign-message history",
  // preflight queries
  "skill-check",
  "cli-check",
] as const;

/**
 * Flags the read-only commands above use. A flag-like token outside this set is refused: without
 * it, a value the model supplies could smuggle a mutating flag into a read-only command.
 * `--json` is appended by `runBaw()`, not by callers.
 *
 * Derived from the flags that appear on allowlisted commands in the skill's reference files —
 * regenerate with the script in README §维护 rather than by hand. Mutating flags (`--requestId`,
 * `--to`, `--value`, `--max`) are deliberately absent.
 */
const ALLOWED_FLAGS = new Set([
  "--json",
  "--action",
  "--address",
  "--amount",
  "--binanceChainId",
  "--claimType",
  "--contractAddresses",
  "--current-version",
  "--defiProtocolId",
  "--endTime",
  "--filter",
  "--fromToken",
  "--fromTokenQty",
  "--gasLevel",
  "--investType",
  "--investmentId",
  "--l",
  "--limit",
  "--marketId",
  "--marketTopicId",
  "--nextCursor",
  "--nextToken",
  "--nftId",
  "--offset",
  "--order-id",
  "--orderBy",
  "--orderId",
  "--orderType",
  "--page",
  "--pageSize",
  "--paymentRequirements",
  "--priceLimit",
  "--priceRange",
  "--query",
  "--ratio",
  "--refresh",
  "--required-version",
  "--side",
  "--size",
  "--skill-name",
  "--slippage",
  "--slippageBps",
  "--sortBy",
  "--sortDirection",
  "--sortField",
  "--sortType",
  "--spender",
  "--startTime",
  "--status",
  "--strategyId",
  "--symbol",
  "--tab",
  "--tickLower",
  "--tickUpper",
  "--toToken",
  "--tokenAddress",
  "--tokenContract",
  "--tokenId",
  "--tx",
  "--type",
]);

const READ_ONLY = new Set<string>(READ_ONLY_COMMANDS);

/** Deepest command in this CLI is three tokens (`prediction position settled-history`). */
const MAX_COMMAND_DEPTH = 3;

export class WalletPolicyError extends Error {
  readonly argv: readonly string[];
  readonly command: string;

  constructor(argv: readonly string[], command: string, reason: string) {
    super(`wallet policy refused \`baw ${command || argv.join(" ")}\`: ${reason}`);
    this.name = "WalletPolicyError";
    this.argv = argv;
    this.command = command;
  }
}

/**
 * The leading non-flag tokens of a `baw` invocation.
 * The CLI takes its command first and its flags after, so this is the command path.
 */
export function commandPath(argv: readonly string[]): string[] {
  const path: string[] = [];
  for (const token of argv) {
    if (token === "" || token.startsWith("-")) break;
    path.push(token);
    if (path.length === MAX_COMMAND_DEPTH) break;
  }
  return path;
}

export type WalletDecision =
  | { allowed: true; command: string }
  | { allowed: false; command: string; reason: string };

/** Decide whether a `baw` argv is permitted. Pure; no IO. */
export function classifyBaw(argv: readonly string[]): WalletDecision {
  const path = commandPath(argv);
  if (path.length === 0) {
    return { allowed: false, command: "", reason: "no subcommand given" };
  }

  const command = path.join(" ");
  if (!READ_ONLY.has(command)) {
    return {
      allowed: false,
      command,
      reason:
        `not in the phase 1 read-only allowlist (${READ_ONLY.size} commands). ` +
        "State-changing wallet commands, external signing, and anything unknown are refused by default.",
    };
  }

  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [flag] = token.split("=", 1);
    if (flag !== undefined && !ALLOWED_FLAGS.has(flag)) {
      return {
        allowed: false,
        command,
        reason: `flag ${flag} is not allowed for a read-only command`,
      };
    }
  }

  return { allowed: true, command };
}

/** Throws {@link WalletPolicyError} unless the argv passes {@link classifyBaw}. */
export function assertReadOnly(argv: readonly string[]): void {
  const decision = classifyBaw(argv);
  if (!decision.allowed) {
    throw new WalletPolicyError(argv, decision.command, decision.reason);
  }
}

export function isReadOnlyCommand(argv: readonly string[]): boolean {
  return classifyBaw(argv).allowed;
}

export function readOnlyCommandCount(): number {
  return READ_ONLY.size;
}

const WALLET_CLI_MENTION = /\bbaw\b|agentic-wallet/i;

/**
 * True when a shell command string appears to reach the wallet CLI.
 *
 * This is a *heuristic*, and it is deliberately over-eager: it matches the bare word `baw`, the
 * npm package name, and a path ending in `/baw`. It stops accidents — a model that decides to
 * shell out instead of using the wallet tools — and it cannot stop an adversary, because string
 * matching over shell syntax is not sound (`eval "$(echo … | base64 -d)"` defeats it).
 *
 * That gap is why phase 1 removes the shell tool from the agent entirely
 * (`AGENT_SHELL=off`, the default) rather than relying on this function. See README §安全模型.
 */
export function mentionsWalletCli(command: string): boolean {
  return WALLET_CLI_MENTION.test(command);
}
