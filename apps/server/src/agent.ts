/**
 * The agent host: one pi SDK session with our extensions, skills, and model choices.
 *
 * Phase 1 deliberately narrows two of pi's defaults:
 *  - `bash`/`powershell` are excluded unless `AGENT_SHELL=on`. The skill documents that the wallet
 *    is reachable as a CLI, so a shell-capable agent has a path around every tool-level guard we
 *    install. Removing the tool is the only structurally sound version of "read-only" here.
 *  - the `binance-agentic-wallet` skill is filtered out. It is a command-routing document; in phase
 *    1 the model should know about `wallet_*` tools, not about `baw` subcommands it cannot run.
 */

import { mkdir } from "node:fs/promises";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	SessionManager,
	type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { createWalletExtension } from "./wallet-tools.ts";
import { WALLET_POLICY_DOC } from "./wallet-policy-doc.ts";

const WALLET_SKILL_NAME = "binance-agentic-wallet";

export interface WalletAgentOptions {
	cwd: string;
	sessionDir: string;
	/** "provider/modelId", e.g. "deepseek/deepseek-chat". Undefined: pi's own default. */
	model: string | undefined;
	shell: boolean;
	includeWalletSkill: boolean;
}

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
		throw new Error(`AGENT_MODEL must look like "provider/modelId", for example "deepseek/deepseek-chat" (got "${spec}")`);
	}
	const provider = spec.slice(0, slash);
	const modelId = spec.slice(slash + 1);
	const model = runtime.getModel(provider, modelId);
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

export async function createWalletAgent(options: WalletAgentOptions): Promise<WalletAgent> {
	await mkdir(options.cwd, { recursive: true });
	await mkdir(options.sessionDir, { recursive: true });

	const modelRuntime = await ModelRuntime.create();
	const model = options.model === undefined ? undefined : await resolveModel(modelRuntime, options.model);

	const loader = new DefaultResourceLoader({
		cwd: options.cwd,
		agentDir: getAgentDir(),
		extensionFactories: [createWalletExtension()],
		agentsFilesOverride: (current) => ({
			agentsFiles: [...current.agentsFiles, { path: "<wallet-policy>", content: WALLET_POLICY_DOC }],
		}),
		...(options.includeWalletSkill
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

	const { session } = await createAgentSession({
		cwd: options.cwd,
		modelRuntime,
		sessionManager: SessionManager.create(options.cwd, options.sessionDir),
		resourceLoader: loader,
		...(model === undefined ? {} : { model }),
		...(!options.shell ? { excludeTools: ["bash", "powershell"] } : {}),
	});

	const resolved = session.model;
	return {
		session,
		cwd: options.cwd,
		shell: options.shell,
		modelLabel: resolved === undefined ? "(default)" : `${resolved.provider}/${resolved.id}`,
		skills: skillState.skills.map((skill) => skill.name),
		skillDiagnostics: skillState.diagnostics.map((d) => `${d.type}: ${d.message}`),
		dispose: () => session.dispose(),
	};
}
