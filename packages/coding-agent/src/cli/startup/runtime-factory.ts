/**
 * Runtime construction boundary for the main CLI.
 *
 * The CLI creates AgentSession runtimes more than once: once for the initial
 * session and again when a resumed/imported session switches workspace cwd.
 * This module centralizes that cwd-sensitive path so `main.ts` coordinates
 * process flow while runtime creation remains testable and reusable.
 */

import { supportsXhigh } from "@mariozechner/pi-ai";
import type { CreateAgentSessionRuntimeFactory } from "../../core/agent-session-runtime.js";
import type { AgentSessionRuntimeDiagnostic } from "../../core/agent-session-services.js";
import { createAgentSessionFromServices, createAgentSessionServices } from "../../core/agent-session-services.js";
import type { AuthStorage } from "../../core/auth-storage.js";
import type { ExtensionFactory } from "../../core/extensions/types.js";
import { resolveModelScope } from "../../core/model-resolver.js";
import type { Args } from "../args.js";
import { buildSessionOptions, collectSettingsDiagnostics } from "./runtime-bootstrap.js";

/**
 * CLI state that is independent from the active session cwd.
 *
 * Parsed flags, injected extension factories, and already-normalized resource
 * paths are captured once by `main.ts` and reused for every runtime instance.
 * The returned factory combines these stable inputs with the runtime cwd passed
 * by `createAgentSessionRuntime`.
 */
export interface MainRuntimeFactoryOptions {
	parsed: Args;
	authStorage: AuthStorage;
	resolvedExtensionPaths?: string[];
	resolvedSkillPaths?: string[];
	resolvedPromptTemplatePaths?: string[];
	resolvedThemePaths?: string[];
	extensionFactories?: ExtensionFactory[];
}

/**
 * Create the runtime factory consumed by `createAgentSessionRuntime`.
 *
 * The factory rebuilds services from the target cwd, resolves scoped models
 * against that cwd's settings and resource registry, applies one-shot CLI auth
 * overrides, and returns diagnostics instead of printing so startup callers can
 * decide whether to continue or exit.
 */
export function createMainRuntimeFactory(options: MainRuntimeFactoryOptions): CreateAgentSessionRuntimeFactory {
	const {
		parsed,
		authStorage,
		resolvedExtensionPaths,
		resolvedSkillPaths,
		resolvedPromptTemplatePaths,
		resolvedThemePaths,
		extensionFactories,
	} = options;

	return async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			authStorage,
			extensionFlagValues: parsed.unknownFlags,
			resourceLoaderOptions: {
				additionalExtensionPaths: resolvedExtensionPaths,
				additionalSkillPaths: resolvedSkillPaths,
				additionalPromptTemplatePaths: resolvedPromptTemplatePaths,
				additionalThemePaths: resolvedThemePaths,
				noExtensions: parsed.noExtensions,
				noSkills: parsed.noSkills,
				noPromptTemplates: parsed.noPromptTemplates,
				noThemes: parsed.noThemes,
				noContextFiles: parsed.noContextFiles,
				systemPrompt: parsed.systemPrompt,
				appendSystemPrompt: parsed.appendSystemPrompt,
				extensionFactories,
			},
		});
		const { settingsManager, modelRegistry, resourceLoader } = services;
		const diagnostics: AgentSessionRuntimeDiagnostic[] = [
			...services.diagnostics,
			...collectSettingsDiagnostics(settingsManager, "runtime creation"),
			...resourceLoader.getExtensions().errors.map(({ path, error }) => ({
				type: "error" as const,
				message: `Failed to load extension "${path}": ${error}`,
			})),
		];

		const modelPatterns = parsed.models ?? settingsManager.getEnabledModels();
		const scopedModels =
			modelPatterns && modelPatterns.length > 0 ? await resolveModelScope(modelPatterns, modelRegistry) : [];
		const {
			options: sessionOptions,
			cliThinkingFromModel,
			diagnostics: sessionOptionDiagnostics,
		} = buildSessionOptions(
			parsed,
			scopedModels,
			sessionManager.buildSessionContext().messages.length > 0,
			modelRegistry,
			settingsManager,
		);
		diagnostics.push(...sessionOptionDiagnostics);

		if (parsed.apiKey) {
			if (!sessionOptions.model) {
				diagnostics.push({
					type: "error",
					message: "--api-key requires a model to be specified via --model, --provider/--model, or --models",
				});
			} else {
				authStorage.setRuntimeApiKey(sessionOptions.model.provider, parsed.apiKey);
			}
		}

		const created = await createAgentSessionFromServices({
			services,
			sessionManager,
			sessionStartEvent,
			model: sessionOptions.model,
			thinkingLevel: sessionOptions.thinkingLevel,
			scopedModels: sessionOptions.scopedModels,
			tools: sessionOptions.tools,
			noTools: sessionOptions.noTools,
			customTools: sessionOptions.customTools,
		});
		const cliThinkingOverride = parsed.thinking !== undefined || cliThinkingFromModel;
		if (created.session.model && cliThinkingOverride) {
			let effectiveThinking = created.session.thinkingLevel;
			if (!created.session.model.reasoning) {
				effectiveThinking = "off";
			} else if (effectiveThinking === "xhigh" && !supportsXhigh(created.session.model)) {
				effectiveThinking = "high";
			}
			if (effectiveThinking !== created.session.thinkingLevel) {
				created.session.setThinkingLevel(effectiveThinking);
			}
		}

		return {
			...created,
			services,
			diagnostics,
		};
	};
}
