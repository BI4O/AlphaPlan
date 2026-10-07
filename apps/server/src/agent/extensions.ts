/**
 * ★ Extension point: everything pi runs in this process is assembled here.
 *
 * To add a capability, add a factory to the list. Three shapes are worth knowing:
 *  - a local extension under `src/<domain>/index.ts` exporting `create<Domain>Extension()`
 *    (see `../wallet/index.ts` for the smallest complete example)
 *  - pi's built-in extensions: `createCodemodeExtension`, `createToolSearchExtension`,
 *    `createMcpExtension`
 *  - a file-based extension path, via `DefaultResourceLoader.additionalExtensionPaths`
 *
 * Two rules that are easy to get wrong:
 *  1. SDK sessions do **not** load pi's built-in codemode/tool_search/MCP extensions. The CLI does;
 *     an SDK host opts in explicitly, here.
 *  2. Registering `codemode` or `tool_search` does not activate them. They are activated through
 *     the `defaultTools` setting — that is what `buildDefaultTools()` below is for. Do not use the
 *     `tools` option for this: it would restrict the session to the named tools and hide the rest.
 */

import {
	createCodemodeExtension,
	createMcpExtension,
	createToolSearchExtension,
	type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { createWalletExtension } from "../wallet/index.ts";
import type { AgentConfig } from "../config.ts";

export function buildExtensionFactories(config: AgentConfig): ExtensionFactory[] {
	const factories: ExtensionFactory[] = [
		// The wallet surface and its shell guard. Phase 1: read-only.
		createWalletExtension(),
	];

	if (config.codemode) factories.push(createCodemodeExtension({ mode: "on" }));
	if (config.toolSearch) factories.push(createToolSearchExtension());
	// Reads mcp.json from the agent directory and the trusted project, like the CLI does.
	if (config.mcp) factories.push(createMcpExtension());

	return factories;
}

/** `+name` adds to the configured default tools instead of replacing them. */
export function buildDefaultTools(config: AgentConfig): string[] | undefined {
	const extra: string[] = [];
	if (config.codemode) extra.push("+codemode");
	if (config.toolSearch) extra.push("+tool_search");
	return extra.length === 0 ? undefined : extra;
}
