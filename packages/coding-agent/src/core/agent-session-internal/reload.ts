/**
 * Runtime reload boundary for AgentSession.
 *
 * Reloading replaces cwd-bound services while a session is alive. This module
 * owns the ordered steps that must move together: emit shutdown, rebuild
 * resources, bind extension callbacks, refresh tools/model state, and rebuild
 * runtime-backed registries without widening AgentSession's public API.
 */

import { basename, dirname } from "node:path";
import type { Agent, AgentTool, ThinkingLevel } from "@mariozechner/pi-agent-core";
import { type ImageContent, type Model, resetApiProviders, type TextContent } from "@mariozechner/pi-ai";
import type { ExtensionBindings } from "../agent-session.js";
import type { CompactionResult } from "../compaction/index.js";
import {
	type ContextUsage,
	type ExtensionCommandContextActions,
	type ExtensionErrorListener,
	ExtensionRunner,
	type ExtensionUIContext,
	type SessionStartEvent,
	type ToolDefinition,
	type ToolInfo,
	wrapRegisteredTools,
} from "../extensions/index.js";
import { emitSessionShutdownEvent } from "../extensions/runner.js";
import type { CustomMessage } from "../messages.js";
import type { ModelRegistry } from "../model-registry.js";
import type { PromptTemplate } from "../prompt-templates.js";
import type { ResourceExtensionPaths, ResourceLoader } from "../resource-loader.js";
import type { SessionManager } from "../session-manager.js";
import type { SettingsManager } from "../settings-manager.js";
import type { SlashCommandInfo } from "../slash-commands.js";
import { createSyntheticSourceInfo } from "../source-info.js";
import { createAllToolDefinitions } from "../tools/index.js";
import { createToolDefinitionFromAgentTool } from "../tools/tool-definition-wrapper.js";
import type { ToolDefinitionEntry } from "./tool-registry.js";

/**
 * Options for a session reload operation.
 */
export interface ReloadOptions {
	/** Whether to preserve the current extension runner state */
	preserveExtensions?: boolean;
	/** Additional paths to reload */
	additionalPaths?: string[];
}

/**
 * Determine which resources need refreshing during a reload.
 * Returns a list of resource categories that should be reloaded.
 */
export function getReloadableResources(): string[] {
	return ["extensions", "skills", "promptTemplates", "themes", "contextFiles", "systemPrompt"];
}

/**
 * Internal AgentSession shape required by the reload and runtime helpers.
 */
export interface AgentSessionReloadTarget {
	agent: Agent;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	_modelRegistry: ModelRegistry;
	_resourceLoader: ResourceLoader;
	_cwd: string;
	_customTools: ToolDefinition[];
	_baseToolDefinitions: Map<string, ToolDefinition>;
	_toolRegistry: Map<string, AgentTool>;
	_toolDefinitions: Map<string, ToolDefinitionEntry>;
	_toolPromptSnippets: Map<string, string>;
	_toolPromptGuidelines: Map<string, string[]>;
	_extensionRunner: ExtensionRunner;
	_extensionRunnerRef?: { current?: ExtensionRunner };
	_baseToolsOverride?: Record<string, AgentTool>;
	_allowedToolNames?: Set<string>;
	_sessionStartEvent: SessionStartEvent;
	_extensionUIContext?: ExtensionUIContext;
	_extensionCommandContextActions?: ExtensionCommandContextActions;
	_extensionShutdownHandler?: () => void;
	_extensionErrorListener?: ExtensionErrorListener;
	_extensionErrorUnsubscriber?: () => void;
	_baseSystemPrompt: string;
	model: Model<any> | undefined;
	thinkingLevel: ThinkingLevel;
	promptTemplates: ReadonlyArray<PromptTemplate>;
	pendingMessageCount: number;
	isStreaming: boolean;
	systemPrompt: string;
	getContextUsage(): ContextUsage | undefined;
	getActiveToolNames(): string[];
	getAllTools(): ToolInfo[];
	setActiveToolsByName(toolNames: string[]): void;
	sendCustomMessage<T = unknown>(
		message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
		options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
	): Promise<void>;
	sendUserMessage(
		content: string | Array<TextContent | ImageContent>,
		options?: { deliverAs?: "steer" | "followUp" },
	): Promise<void>;
	setSessionName(name: string): void;
	abort(): Promise<void>;
	compact(customInstructions?: string): Promise<CompactionResult>;
	setModel(model: Model<any>): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): void;
	_normalizePromptSnippet(text: string | undefined): string | undefined;
	_normalizePromptGuidelines(guidelines: string[] | undefined): string[];
	_rebuildSystemPrompt(toolNames: string[]): string;
	_applyExtensionBindings(runner: ExtensionRunner): void;
	_refreshCurrentModelFromRegistry(): void;
	_bindExtensionCore(runner: ExtensionRunner): void;
	_refreshToolRegistry(options?: { activeToolNames?: string[]; includeAllExtensionTools?: boolean }): void;
	_buildRuntime(options: {
		activeToolNames?: string[];
		flagValues?: Map<string, boolean | string>;
		includeAllExtensionTools?: boolean;
	}): void;
}

/**
 * Bind external UI/command/shutdown/error integrations to the extension
 * runtime and perform the initial extension resource discovery.
 */
export async function bindSessionExtensions(
	target: AgentSessionReloadTarget,
	bindings: ExtensionBindings,
): Promise<void> {
	if (bindings.uiContext !== undefined) {
		target._extensionUIContext = bindings.uiContext;
	}
	if (bindings.commandContextActions !== undefined) {
		target._extensionCommandContextActions = bindings.commandContextActions;
	}
	if (bindings.shutdownHandler !== undefined) {
		target._extensionShutdownHandler = bindings.shutdownHandler;
	}
	if (bindings.onError !== undefined) {
		target._extensionErrorListener = bindings.onError;
	}

	target._applyExtensionBindings(target._extensionRunner);
	await target._extensionRunner.emit(target._sessionStartEvent);
	await extendResourcesFromExtensions(target, target._sessionStartEvent.reason === "reload" ? "reload" : "startup");
}

/**
 * Discover and register additional skills/prompts/themes provided by active
 * extensions.
 */
export async function extendResourcesFromExtensions(
	target: Pick<
		AgentSessionReloadTarget,
		| "_baseSystemPrompt"
		| "_rebuildSystemPrompt"
		| "_resourceLoader"
		| "_cwd"
		| "_extensionRunner"
		| "agent"
		| "getActiveToolNames"
	>,
	reason: "startup" | "reload",
): Promise<void> {
	if (!target._extensionRunner.hasHandlers("resources_discover")) {
		return;
	}

	const { skillPaths, promptPaths, themePaths } = await target._extensionRunner.emitResourcesDiscover(
		target._cwd,
		reason,
	);

	if (skillPaths.length === 0 && promptPaths.length === 0 && themePaths.length === 0) {
		return;
	}

	const extensionPaths: ResourceExtensionPaths = {
		skillPaths: buildExtensionResourcePaths(skillPaths),
		promptPaths: buildExtensionResourcePaths(promptPaths),
		themePaths: buildExtensionResourcePaths(themePaths),
	};

	target._resourceLoader.extendResources(extensionPaths);
	target._baseSystemPrompt = target._rebuildSystemPrompt(target.getActiveToolNames());
	target.agent.state.systemPrompt = target._baseSystemPrompt;
}

/**
 * Convert extension-discovered resource paths into the ResourceLoader metadata
 * format.
 */
export function buildExtensionResourcePaths(entries: Array<{ path: string; extensionPath: string }>): Array<{
	path: string;
	metadata: { source: string; scope: "temporary"; origin: "top-level"; baseDir?: string };
}> {
	return entries.map((entry) => {
		const source = getExtensionSourceLabel(entry.extensionPath);
		const baseDir = entry.extensionPath.startsWith("<") ? undefined : dirname(entry.extensionPath);
		return {
			path: entry.path,
			metadata: {
				source,
				scope: "temporary",
				origin: "top-level",
				baseDir,
			},
		};
	});
}

/**
 * Derive a stable source label for extension-provided resources.
 */
export function getExtensionSourceLabel(extensionPath: string): string {
	if (extensionPath.startsWith("<")) {
		return `extension:${extensionPath.replace(/[<>]/g, "")}`;
	}

	const baseName = basename(extensionPath);
	return `extension:${baseName.replace(/\.(ts|js)$/, "")}`;
}

/**
 * Apply UI bindings and error listeners to the current extension runner.
 */
export function applyExtensionBindings(
	target: Pick<
		AgentSessionReloadTarget,
		| "_extensionCommandContextActions"
		| "_extensionErrorListener"
		| "_extensionErrorUnsubscriber"
		| "_extensionUIContext"
	>,
	runner: ExtensionRunner,
): void {
	runner.setUIContext(target._extensionUIContext);
	runner.bindCommandContext(target._extensionCommandContextActions);

	target._extensionErrorUnsubscriber?.();
	target._extensionErrorUnsubscriber = target._extensionErrorListener
		? runner.onError(target._extensionErrorListener)
		: undefined;
}

/**
 * Refresh the current model reference after provider registration changes.
 */
export function refreshCurrentModelFromRegistry(
	target: Pick<AgentSessionReloadTarget, "_modelRegistry" | "agent" | "model">,
): void {
	const currentModel = target.model;
	if (!currentModel) {
		return;
	}

	const refreshedModel = target._modelRegistry.find(currentModel.provider, currentModel.id);
	if (!refreshedModel || refreshedModel === currentModel) {
		return;
	}

	target.agent.state.model = refreshedModel;
}

/**
 * Bind the extension runtime to the AgentSession core actions.
 */
export function bindExtensionCore(target: AgentSessionReloadTarget, runner: ExtensionRunner): void {
	const getCommands = (): SlashCommandInfo[] => {
		const extensionCommands: SlashCommandInfo[] = runner.getRegisteredCommands().map((command) => ({
			name: command.invocationName,
			description: command.description,
			source: "extension",
			sourceInfo: command.sourceInfo,
		}));

		const templates: SlashCommandInfo[] = target.promptTemplates.map((template) => ({
			name: template.name,
			description: template.description,
			source: "prompt",
			sourceInfo: template.sourceInfo,
		}));

		const skills: SlashCommandInfo[] = target._resourceLoader.getSkills().skills.map((skill) => ({
			name: `skill:${skill.name}`,
			description: skill.description,
			source: "skill",
			sourceInfo: skill.sourceInfo,
		}));

		return [...extensionCommands, ...templates, ...skills];
	};

	runner.bindCore(
		{
			sendMessage: (message, options) => {
				target.sendCustomMessage(message, options).catch((error) => {
					runner.emitError({
						extensionPath: "<runtime>",
						event: "send_message",
						error: error instanceof Error ? error.message : String(error),
					});
				});
			},
			sendUserMessage: (content, options) => {
				target.sendUserMessage(content, options).catch((error) => {
					runner.emitError({
						extensionPath: "<runtime>",
						event: "send_user_message",
						error: error instanceof Error ? error.message : String(error),
					});
				});
			},
			appendEntry: (customType, data) => {
				target.sessionManager.appendCustomEntry(customType, data);
			},
			setSessionName: (name) => {
				target.setSessionName(name);
			},
			getSessionName: () => {
				return target.sessionManager.getSessionName();
			},
			setLabel: (entryId, label) => {
				target.sessionManager.appendLabelChange(entryId, label);
			},
			getActiveTools: () => target.getActiveToolNames(),
			getAllTools: () => target.getAllTools(),
			setActiveTools: (toolNames) => target.setActiveToolsByName(toolNames),
			refreshTools: () => target._refreshToolRegistry(),
			getCommands,
			setModel: async (model) => {
				if (!target._modelRegistry.hasConfiguredAuth(model)) {
					return false;
				}
				await target.setModel(model);
				return true;
			},
			getThinkingLevel: () => target.thinkingLevel,
			setThinkingLevel: (level) => target.setThinkingLevel(level),
		},
		{
			getModel: () => target.model,
			isIdle: () => !target.isStreaming,
			getSignal: () => target.agent.signal,
			abort: () => target.abort(),
			hasPendingMessages: () => target.pendingMessageCount > 0,
			shutdown: () => {
				target._extensionShutdownHandler?.();
			},
			getContextUsage: () => target.getContextUsage(),
			compact: (options) => {
				void (async () => {
					try {
						const result = await target.compact(options?.customInstructions);
						options?.onComplete?.(result);
					} catch (error) {
						const err = error instanceof Error ? error : new Error(String(error));
						options?.onError?.(err);
					}
				})();
			},
			getSystemPrompt: () => target.systemPrompt,
		},
		{
			registerProvider: (name, config) => {
				target._modelRegistry.registerProvider(name, config);
				target._refreshCurrentModelFromRegistry();
			},
			unregisterProvider: (name) => {
				target._modelRegistry.unregisterProvider(name);
				target._refreshCurrentModelFromRegistry();
			},
		},
	);
}

/**
 * Rebuild the tool registry and active-tool selection after extension changes.
 */
export function refreshToolRegistry(
	target: Pick<
		AgentSessionReloadTarget,
		| "_allowedToolNames"
		| "_baseToolDefinitions"
		| "_customTools"
		| "_extensionRunner"
		| "_toolDefinitions"
		| "_toolPromptGuidelines"
		| "_toolPromptSnippets"
		| "_toolRegistry"
		| "_normalizePromptGuidelines"
		| "_normalizePromptSnippet"
		| "getActiveToolNames"
		| "setActiveToolsByName"
	>,
	options?: { activeToolNames?: string[]; includeAllExtensionTools?: boolean },
): void {
	const previousRegistryNames = new Set(target._toolRegistry.keys());
	const previousActiveToolNames = target.getActiveToolNames();
	const allowedToolNames = target._allowedToolNames;
	const isAllowedTool = (name: string): boolean => !allowedToolNames || allowedToolNames.has(name);

	const registeredTools = target._extensionRunner.getAllRegisteredTools();
	const allCustomTools = [
		...registeredTools,
		...target._customTools.map((definition) => ({
			definition,
			sourceInfo: createSyntheticSourceInfo(`<sdk:${definition.name}>`, { source: "sdk" }),
		})),
	].filter((tool) => isAllowedTool(tool.definition.name));

	const definitionRegistry = new Map<string, ToolDefinitionEntry>(
		Array.from(target._baseToolDefinitions.entries())
			.filter(([name]) => isAllowedTool(name))
			.map(([name, definition]) => [
				name,
				{
					definition,
					sourceInfo: createSyntheticSourceInfo(`<builtin:${name}>`, { source: "builtin" }),
				},
			]),
	);

	for (const tool of allCustomTools) {
		definitionRegistry.set(tool.definition.name, {
			definition: tool.definition,
			sourceInfo: tool.sourceInfo,
		});
	}

	target._toolDefinitions = definitionRegistry;
	target._toolPromptSnippets = new Map(
		Array.from(definitionRegistry.values())
			.map(({ definition }) => {
				const snippet = target._normalizePromptSnippet(definition.promptSnippet);
				return snippet ? ([definition.name, snippet] as const) : undefined;
			})
			.filter((entry): entry is readonly [string, string] => entry !== undefined),
	);
	target._toolPromptGuidelines = new Map(
		Array.from(definitionRegistry.values())
			.map(({ definition }) => {
				const guidelines = target._normalizePromptGuidelines(definition.promptGuidelines);
				return guidelines.length > 0 ? ([definition.name, guidelines] as const) : undefined;
			})
			.filter((entry): entry is readonly [string, string[]] => entry !== undefined),
	);

	const wrappedExtensionTools = wrapRegisteredTools(allCustomTools, target._extensionRunner);
	const wrappedBuiltInTools = wrapRegisteredTools(
		Array.from(target._baseToolDefinitions.values())
			.filter((definition) => isAllowedTool(definition.name))
			.map((definition) => ({
				definition,
				sourceInfo: createSyntheticSourceInfo(`<builtin:${definition.name}>`, { source: "builtin" }),
			})),
		target._extensionRunner,
	);

	const toolRegistry = new Map(wrappedBuiltInTools.map((tool) => [tool.name, tool]));
	for (const tool of wrappedExtensionTools as AgentTool[]) {
		toolRegistry.set(tool.name, tool);
	}
	target._toolRegistry = toolRegistry;

	const nextActiveToolNames = (
		options?.activeToolNames ? [...options.activeToolNames] : [...previousActiveToolNames]
	).filter((name) => isAllowedTool(name));

	if (allowedToolNames) {
		for (const toolName of target._toolRegistry.keys()) {
			if (allowedToolNames.has(toolName)) {
				nextActiveToolNames.push(toolName);
			}
		}
	} else if (options?.includeAllExtensionTools) {
		for (const tool of wrappedExtensionTools) {
			nextActiveToolNames.push(tool.name);
		}
	} else if (!options?.activeToolNames) {
		for (const toolName of target._toolRegistry.keys()) {
			if (!previousRegistryNames.has(toolName)) {
				nextActiveToolNames.push(toolName);
			}
		}
	}

	target.setActiveToolsByName([...new Set(nextActiveToolNames)]);
}

/**
 * Rebuild the extension runner and tool registry from the current resource
 * loader and settings state.
 */
export function buildRuntime(
	target: Pick<
		AgentSessionReloadTarget,
		| "_baseToolDefinitions"
		| "_baseToolsOverride"
		| "_bindExtensionCore"
		| "_cwd"
		| "_extensionRunner"
		| "_extensionRunnerRef"
		| "_modelRegistry"
		| "_resourceLoader"
		| "_applyExtensionBindings"
		| "_refreshToolRegistry"
		| "sessionManager"
		| "settingsManager"
	>,
	options: {
		activeToolNames?: string[];
		flagValues?: Map<string, boolean | string>;
		includeAllExtensionTools?: boolean;
	},
): void {
	const autoResizeImages = target.settingsManager.getImageAutoResize();
	const shellCommandPrefix = target.settingsManager.getShellCommandPrefix();
	const shellPath = target.settingsManager.getShellPath();
	const baseToolDefinitions = target._baseToolsOverride
		? Object.fromEntries(
				Object.entries(target._baseToolsOverride).map(([name, tool]) => [
					name,
					createToolDefinitionFromAgentTool(tool),
				]),
			)
		: createAllToolDefinitions(target._cwd, {
				read: { autoResizeImages },
				bash: { commandPrefix: shellCommandPrefix, shellPath },
			});

	target._baseToolDefinitions = new Map(
		Object.entries(baseToolDefinitions).map(([name, definition]) => [name, definition as ToolDefinition]),
	);

	const extensionsResult = target._resourceLoader.getExtensions();
	if (options.flagValues) {
		for (const [name, value] of options.flagValues) {
			extensionsResult.runtime.flagValues.set(name, value);
		}
	}

	target._extensionRunner = new ExtensionRunner(
		extensionsResult.extensions,
		extensionsResult.runtime,
		target._cwd,
		target.sessionManager,
		target._modelRegistry,
	);
	if (target._extensionRunnerRef) {
		target._extensionRunnerRef.current = target._extensionRunner;
	}

	target._bindExtensionCore(target._extensionRunner);
	target._applyExtensionBindings(target._extensionRunner);

	const defaultActiveToolNames = target._baseToolsOverride
		? Object.keys(target._baseToolsOverride)
		: ["read", "bash", "edit", "write"];
	target._refreshToolRegistry({
		activeToolNames: options.activeToolNames ?? defaultActiveToolNames,
		includeAllExtensionTools: options.includeAllExtensionTools,
	});
}

/**
 * Reload settings, resources, and extension runtime while preserving session
 * state and extension flags.
 */
export async function reloadSession(
	target: Pick<
		AgentSessionReloadTarget,
		| "_buildRuntime"
		| "_extensionCommandContextActions"
		| "_extensionErrorListener"
		| "_extensionRunner"
		| "_extensionShutdownHandler"
		| "_extensionUIContext"
		| "_resourceLoader"
		| "getActiveToolNames"
		| "settingsManager"
	>,
): Promise<void> {
	const previousFlagValues = target._extensionRunner.getFlagValues();
	await emitSessionShutdownEvent(target._extensionRunner, { type: "session_shutdown", reason: "reload" });
	await target.settingsManager.reload();
	resetApiProviders();
	await target._resourceLoader.reload();
	target._buildRuntime({
		activeToolNames: target.getActiveToolNames(),
		flagValues: previousFlagValues,
		includeAllExtensionTools: true,
	});

	const hasBindings =
		target._extensionUIContext ||
		target._extensionCommandContextActions ||
		target._extensionShutdownHandler ||
		target._extensionErrorListener;
	if (hasBindings) {
		await target._extensionRunner.emit({ type: "session_start", reason: "reload" });
		await extendResourcesFromExtensions(target as AgentSessionReloadTarget, "reload");
	}
}
