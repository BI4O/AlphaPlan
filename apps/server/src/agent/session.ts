/**
 * Assembling the pi session: skills, extensions, skills policy, model, session storage.
 *
 * Phase 1 narrows two pi defaults on purpose:
 *  - `bash`/`powershell` are excluded unless `AGENT_SHELL=on` (see `../config.ts`)
 *  - the `binance-agentic-wallet` skill is filtered out: it is a command-routing document, and in
 *    phase 1 the model should know about the `wallet_*` tools, not about `baw` subcommands it
 *    cannot run. `AGENT_INCLUDE_WALLET_SKILL=on` restores it for phase 2.
 */

import { mkdir } from "node:fs/promises";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { buildDefaultTools, buildExtensionFactories } from "./extensions.ts";
import { WALLET_POLICY_DOC } from "../wallet/policy-doc.ts";
import type { AgentConfig } from "../config.ts";

const WALLET_SKILL_NAME = "binance-agentic-wallet";

export interface WalletAgent {
	session: AgentSession;
	cwd: string;
	shell: boolean;
	modelLabel: string;
	skills: string[];
	skillDiagnostics: string[];
	dispose(): void;
}

async function resolveModel(runtime: ModelRuntime, spec: string) {
	const slash = spec.indexOf("/");
	if (slash <= 0 || slash === spec.length - 1) {
		throw new Error(
			`AGENT_MODEL must look like "provider/modelId", for example "deepseek/deepseek-chat" (got "${spec}")`,
		);
	}
	const model = runtime.getModel(spec.slice(0, slash), spec.slice(slash + 1));
	if (model !== undefined) return model;

	const available = await runtime.getAvailable();
	const names = available.map((m) => `${m.provider}/${m.id}`);
	throw new Error(
		`AGENT_MODEL="${spec}" is not a known model. ${
			names.length === 0
				? "No provider credentials were found either — set a key such as DEEPSEEK_API_KEY or OPENAI_API_KEY."
				: `Available: ${names.join(", ")}`
		}`,
	);
}

export async function createWalletAgent(config: AgentConfig): Promise<WalletAgent> {
	await mkdir(config.cwd, { recursive: true });
	await mkdir(config.sessionDir, { recursive: true });

	const modelRuntime = await ModelRuntime.create();
	const model = config.model === undefined ? undefined : await resolveModel(modelRuntime, config.model);

	const loader = new DefaultResourceLoader({
		cwd: config.cwd,
		agentDir: getAgentDir(),
		extensionFactories: buildExtensionFactories(config),
		// The policy as prose, next to the policy as code. See ../wallet/policy-doc.ts.
		agentsFilesOverride: (current) => ({
			agentsFiles: [...current.agentsFiles, { path: "<wallet-policy>", content: WALLET_POLICY_DOC }],
		}),
		...(config.includeWalletSkill
			? {}
			: {
					skillsOverride: (current) => ({
						skills: current.skills.filter((skill) => skill.name !== WALLET_SKILL_NAME),
						diagnostics: current.diagnostics,
					}),
				}),
	});
	await loader.reload();

	const skillState = loader.getSkills();

	const defaultTools = buildDefaultTools(config);
	const settingsManager = defaultTools === undefined ? undefined : SettingsManager.create(config.cwd);
	if (settingsManager !== undefined && defaultTools !== undefined) {
		settingsManager.applyOverrides({ defaultTools });
	}

	const { session } = await createAgentSession({
		cwd: config.cwd,
		modelRuntime,
		sessionManager: SessionManager.create(config.cwd, config.sessionDir),
		resourceLoader: loader,
		...(settingsManager === undefined ? {} : { settingsManager }),
		...(model === undefined ? {} : { model }),
		...(!config.shell ? { excludeTools: ["bash", "powershell"] } : {}),
	});

	// Required for extensions that connect on `session_start`, which is how the MCP extension
	// reaches its servers. Harmless otherwise.
	if (config.mcp) await session.bindExtensions({});

	const resolved = session.model;
	return {
		session,
		cwd: config.cwd,
		shell: config.shell,
		modelLabel: resolved === undefined ? "(default)" : `${resolved.provider}/${resolved.id}`,
		skills: skillState.skills.map((skill) => skill.name),
		skillDiagnostics: skillState.diagnostics.map((d) => `${d.type}: ${d.message}`),
		dispose: () => session.dispose(),
	};
}
