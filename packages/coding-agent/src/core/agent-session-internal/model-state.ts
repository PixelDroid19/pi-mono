/**
 * Model selection and reasoning configuration boundary for AgentSession.
 *
 * Model changes affect persisted session history, default settings, extension
 * notifications, active tool definitions, and the generated system prompt.
 * Centralizing those side effects keeps the public facade small while preserving
 * the exact sequence required by CLI and SDK callers.
 */

import type { Agent, AgentTool, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import { modelsAreEqual, supportsXhigh } from "@mariozechner/pi-ai";
import { DEFAULT_THINKING_LEVEL } from "../defaults.js";
import type { ExtensionRunner } from "../extensions/index.js";
import type { ModelRegistry } from "../model-registry.js";
import type { ResourceLoader } from "../resource-loader.js";
import type { SessionManager } from "../session-manager.js";
import type { SettingsManager } from "../settings-manager.js";
import type { BuildSystemPromptOptions } from "../system-prompt.js";
import { buildSystemPromptFromTools } from "./tool-registry.js";

/**
 * Internal AgentSession state required by model and thinking transitions.
 */
export interface AgentSessionModelTarget {
	agent: Agent;
	sessionManager: Pick<SessionManager, "appendModelChange" | "appendThinkingLevelChange">;
	settingsManager: Pick<
		SettingsManager,
		"getDefaultThinkingLevel" | "setDefaultModelAndProvider" | "setDefaultThinkingLevel"
	>;
	_modelRegistry: Pick<ModelRegistry, "getAvailable" | "hasConfiguredAuth">;
	_extensionRunner: Pick<ExtensionRunner, "emit">;
	_scopedModels: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
	_cwd: string;
	_toolRegistry: Map<string, AgentTool>;
	_toolPromptSnippets: Map<string, string>;
	_toolPromptGuidelines: Map<string, string[]>;
	_resourceLoader: ResourceLoader;
	_baseSystemPromptOptions: BuildSystemPromptOptions;
	model: Model<any> | undefined;
	thinkingLevel: ThinkingLevel;
	_emitModelSelect(
		nextModel: Model<any>,
		previousModel: Model<any> | undefined,
		source: "set" | "cycle" | "restore",
	): Promise<void>;
	_getThinkingLevelForModelSwitch(explicitLevel?: ThinkingLevel): ThinkingLevel;
	setThinkingLevel(level: ThinkingLevel): void;
	getAvailableThinkingLevels(): ThinkingLevel[];
	supportsThinking(): boolean;
	supportsXhighThinking(): boolean;
	_clampThinkingLevel(level: ThinkingLevel, availableLevels: ThinkingLevel[]): ThinkingLevel;
}

/** Standard reasoning levels for models without xhigh support. */
const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

/** Reasoning levels for models that also support xhigh. */
const THINKING_LEVELS_WITH_XHIGH: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

/**
 * Rebuild the base system prompt from the current tool selection.
 */
export function rebuildSessionSystemPrompt(
	target: Pick<
		AgentSessionModelTarget,
		| "_baseSystemPromptOptions"
		| "_cwd"
		| "_resourceLoader"
		| "_toolPromptGuidelines"
		| "_toolPromptSnippets"
		| "_toolRegistry"
	>,
	toolNames: string[],
): string {
	const { options, prompt } = buildSystemPromptFromTools(
		target._cwd,
		toolNames,
		target._toolRegistry,
		target._toolPromptSnippets,
		target._toolPromptGuidelines,
		target._resourceLoader,
	);
	target._baseSystemPromptOptions = options;
	return prompt;
}

/**
 * Emit the `model_select` extension event only when the model actually changes.
 */
export async function emitModelSelect(
	target: Pick<AgentSessionModelTarget, "_extensionRunner">,
	nextModel: Model<any>,
	previousModel: Model<any> | undefined,
	source: "set" | "cycle" | "restore",
): Promise<void> {
	if (modelsAreEqual(previousModel, nextModel)) {
		return;
	}

	await target._extensionRunner.emit({
		type: "model_select",
		model: nextModel,
		previousModel,
		source,
	});
}

/**
 * Set the active model and persist the choice.
 */
export async function setSessionModel(target: AgentSessionModelTarget, model: Model<any>): Promise<void> {
	if (!target._modelRegistry.hasConfiguredAuth(model)) {
		throw new Error(`No API key for ${model.provider}/${model.id}`);
	}

	const previousModel = target.model;
	const thinkingLevel = target._getThinkingLevelForModelSwitch();
	target.agent.state.model = model;
	target.sessionManager.appendModelChange(model.provider, model.id);
	target.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
	target.setThinkingLevel(thinkingLevel);

	await target._emitModelSelect(model, previousModel, "set");
}

/**
 * Cycle the active model through either scoped or globally available models.
 */
export async function cycleSessionModel(
	target: AgentSessionModelTarget,
	direction: "forward" | "backward" = "forward",
): Promise<{ model: Model<any>; thinkingLevel: ThinkingLevel; isScoped: boolean } | undefined> {
	if (target._scopedModels.length > 0) {
		return cycleScopedSessionModel(target, direction);
	}

	return cycleAvailableSessionModel(target, direction);
}

async function cycleScopedSessionModel(
	target: AgentSessionModelTarget,
	direction: "forward" | "backward",
): Promise<{ model: Model<any>; thinkingLevel: ThinkingLevel; isScoped: boolean } | undefined> {
	const scopedModels = target._scopedModels.filter((scoped) => target._modelRegistry.hasConfiguredAuth(scoped.model));
	if (scopedModels.length <= 1) {
		return undefined;
	}

	const currentModel = target.model;
	let currentIndex = scopedModels.findIndex((scopedModel) => modelsAreEqual(scopedModel.model, currentModel));
	if (currentIndex === -1) {
		currentIndex = 0;
	}

	const nextIndex =
		direction === "forward"
			? (currentIndex + 1) % scopedModels.length
			: (currentIndex - 1 + scopedModels.length) % scopedModels.length;
	const nextModel = scopedModels[nextIndex];
	const thinkingLevel = target._getThinkingLevelForModelSwitch(nextModel.thinkingLevel);

	target.agent.state.model = nextModel.model;
	target.sessionManager.appendModelChange(nextModel.model.provider, nextModel.model.id);
	target.settingsManager.setDefaultModelAndProvider(nextModel.model.provider, nextModel.model.id);
	target.setThinkingLevel(thinkingLevel);

	await target._emitModelSelect(nextModel.model, currentModel, "cycle");

	return {
		model: nextModel.model,
		thinkingLevel: target.thinkingLevel,
		isScoped: true,
	};
}

async function cycleAvailableSessionModel(
	target: AgentSessionModelTarget,
	direction: "forward" | "backward",
): Promise<{ model: Model<any>; thinkingLevel: ThinkingLevel; isScoped: boolean } | undefined> {
	const availableModels = await target._modelRegistry.getAvailable();
	if (availableModels.length <= 1) {
		return undefined;
	}

	const currentModel = target.model;
	let currentIndex = availableModels.findIndex((model) => modelsAreEqual(model, currentModel));
	if (currentIndex === -1) {
		currentIndex = 0;
	}

	const nextIndex =
		direction === "forward"
			? (currentIndex + 1) % availableModels.length
			: (currentIndex - 1 + availableModels.length) % availableModels.length;
	const nextModel = availableModels[nextIndex];
	const thinkingLevel = target._getThinkingLevelForModelSwitch();

	target.agent.state.model = nextModel;
	target.sessionManager.appendModelChange(nextModel.provider, nextModel.id);
	target.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);
	target.setThinkingLevel(thinkingLevel);

	await target._emitModelSelect(nextModel, currentModel, "cycle");

	return {
		model: nextModel,
		thinkingLevel: target.thinkingLevel,
		isScoped: false,
	};
}

/**
 * Apply a thinking level after clamping it to model capabilities.
 */
export function setSessionThinkingLevel(target: AgentSessionModelTarget, level: ThinkingLevel): void {
	const availableLevels = target.getAvailableThinkingLevels();
	const effectiveLevel = availableLevels.includes(level) ? level : target._clampThinkingLevel(level, availableLevels);
	const isChanging = effectiveLevel !== target.agent.state.thinkingLevel;

	target.agent.state.thinkingLevel = effectiveLevel;

	if (!isChanging) {
		return;
	}

	target.sessionManager.appendThinkingLevelChange(effectiveLevel);
	if (target.supportsThinking() || effectiveLevel !== "off") {
		target.settingsManager.setDefaultThinkingLevel(effectiveLevel);
	}
}

/**
 * Cycle to the next available thinking level for the current model.
 */
export function cycleSessionThinkingLevel(
	target: Pick<
		AgentSessionModelTarget,
		"getAvailableThinkingLevels" | "setThinkingLevel" | "supportsThinking" | "thinkingLevel"
	>,
): ThinkingLevel | undefined {
	if (!target.supportsThinking()) {
		return undefined;
	}

	const levels = target.getAvailableThinkingLevels();
	const currentIndex = levels.indexOf(target.thinkingLevel);
	const nextLevel = levels[(currentIndex + 1) % levels.length];
	target.setThinkingLevel(nextLevel);
	return nextLevel;
}

/**
 * Return the valid thinking levels for the current model.
 */
export function getAvailableThinkingLevels(
	target: Pick<AgentSessionModelTarget, "supportsThinking" | "supportsXhighThinking">,
): ThinkingLevel[] {
	if (!target.supportsThinking()) {
		return ["off"];
	}

	return target.supportsXhighThinking() ? THINKING_LEVELS_WITH_XHIGH : THINKING_LEVELS;
}

/**
 * Check whether the current model supports xhigh reasoning.
 */
export function supportsSessionXhighThinking(target: Pick<AgentSessionModelTarget, "model">): boolean {
	return target.model ? supportsXhigh(target.model) : false;
}

/**
 * Check whether the current model supports reasoning at all.
 */
export function supportsSessionThinking(target: Pick<AgentSessionModelTarget, "model">): boolean {
	return !!target.model?.reasoning;
}

/**
 * Decide which thinking level to apply when switching models.
 */
export function getThinkingLevelForModelSwitch(
	target: Pick<AgentSessionModelTarget, "settingsManager" | "supportsThinking" | "thinkingLevel">,
	explicitLevel?: ThinkingLevel,
): ThinkingLevel {
	if (explicitLevel !== undefined) {
		return explicitLevel;
	}

	if (!target.supportsThinking()) {
		return target.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
	}

	return target.thinkingLevel;
}

/**
 * Clamp a requested thinking level to the closest available level.
 */
export function clampThinkingLevel(level: ThinkingLevel, availableLevels: ThinkingLevel[]): ThinkingLevel {
	const available = new Set(availableLevels);
	const requestedIndex = THINKING_LEVELS_WITH_XHIGH.indexOf(level);
	if (requestedIndex === -1) {
		return availableLevels[0] ?? "off";
	}

	for (let i = requestedIndex; i < THINKING_LEVELS_WITH_XHIGH.length; i++) {
		const candidate = THINKING_LEVELS_WITH_XHIGH[i];
		if (available.has(candidate)) {
			return candidate;
		}
	}

	for (let i = requestedIndex - 1; i >= 0; i--) {
		const candidate = THINKING_LEVELS_WITH_XHIGH[i];
		if (available.has(candidate)) {
			return candidate;
		}
	}

	return availableLevels[0] ?? "off";
}
