/**
 * The wallet extension: the read-only tools plus the shell guard, as one installable unit.
 *
 * This is the module `../agent/extensions.ts` imports, and the template to copy for a new domain
 * (a `jobs` extension, an `auth` extension, an MCP bridge, …): export one factory that registers the
 * tools and hooks that domain owns, and keep the policy for it next to it.
 */

import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { installWalletShellGuard } from "./guard.ts";
import { registerWalletTools } from "./tools.ts";

export function createWalletExtension(): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		registerWalletTools(pi);
		installWalletShellGuard(pi);
	};
}

export { WALLET_TOOL_NAMES } from "./tools.ts";
export { SHELL_BLOCK_REASON, mentionsWalletCli } from "./guard.ts";
export { readOnlyCommandCount } from "./policy.ts";
