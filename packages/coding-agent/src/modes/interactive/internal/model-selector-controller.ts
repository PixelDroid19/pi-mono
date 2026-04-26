/**
 * Model selector controllers for InteractiveMode.
 *
 * This module owns selector construction and model-selection side effects for
 * the active model picker and scoped model picker. Shared model discovery remains
 * behind target callbacks so InteractiveMode continues to own session state.
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import type { Component, TUI } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import { resolveModelScope } from "../../../core/model-resolver.js";
import type { SettingsManager } from "../../../core/settings-manager.js";
import type { FooterComponent } from "../components/footer.js";
import { ModelSelectorComponent } from "../components/model-selector.js";
import { ScopedModelsSelectorComponent } from "../components/scoped-models-selector.js";

export interface ModelSelectorTarget {
	footer: FooterComponent;
	session: AgentSession;
	settingsManager: SettingsManager;
	ui: TUI;
	checkDaxnutsEasterEgg(model: Model<Api>): void;
	getModelCandidates(): Promise<Model<Api>[]>;
	maybeWarnAboutAnthropicSubscriptionAuth(model?: Model<Api>): Promise<void>;
	showError(message: string): void;
	showSelector(create: (done: () => void) => { component: Component; focus: Component }): void;
	showStatus(message: string): void;
	updateAvailableProviderCount(): Promise<void>;
	updateEditorBorderColor(): void;
}

/** Show the active model selector and apply model changes to the session. */
export function showModelSelector(target: ModelSelectorTarget, initialSearchInput?: string): void {
	target.showSelector((done) => {
		const selector = new ModelSelectorComponent(
			target.ui,
			target.session.model,
			target.settingsManager,
			target.session.modelRegistry,
			target.session.scopedModels,
			async (model) => {
				try {
					await target.session.setModel(model);
					target.footer.invalidate();
					target.updateEditorBorderColor();
					done();
					target.showStatus(`Model: ${model.id}`);
					void target.maybeWarnAboutAnthropicSubscriptionAuth(model);
					target.checkDaxnutsEasterEgg(model);
				} catch (error) {
					done();
					target.showError(error instanceof Error ? error.message : String(error));
				}
			},
			() => {
				done();
				target.ui.requestRender();
			},
			initialSearchInput,
		);
		return { component: selector, focus: selector };
	});
}

/** Show the scoped model selector and apply session-local or persisted model filters. */
export async function showModelsSelector(target: ModelSelectorTarget): Promise<void> {
	// Get all available models
	target.session.modelRegistry.refresh();
	const allModels = target.session.modelRegistry.getAvailable();

	if (allModels.length === 0) {
		target.showStatus("No models available");
		return;
	}

	// Check if session has scoped models (from previous session-only changes or CLI --models)
	const sessionScopedModels = target.session.scopedModels;
	const hasSessionScope = sessionScopedModels.length > 0;

	// Build enabled model IDs from session state or settings
	let currentEnabledIds: string[] | null = null;

	if (hasSessionScope) {
		// Use current session's scoped models
		currentEnabledIds = sessionScopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`);
	} else {
		// Fall back to settings
		const patterns = target.settingsManager.getEnabledModels();
		if (patterns !== undefined && patterns.length > 0) {
			const scopedModels = await resolveModelScope(patterns, target.session.modelRegistry);
			currentEnabledIds = scopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`);
		}
	}

	// Helper to update session's scoped models (session-only, no persist)
	const updateSessionModels = async (enabledIds: string[] | null) => {
		currentEnabledIds = enabledIds === null ? null : [...enabledIds];
		if (enabledIds && enabledIds.length > 0 && enabledIds.length < allModels.length) {
			const newScopedModels = await resolveModelScope(enabledIds, target.session.modelRegistry);
			target.session.setScopedModels(
				newScopedModels.map((sm) => ({
					model: sm.model,
					thinkingLevel: sm.thinkingLevel,
				})),
			);
		} else {
			// All enabled or none enabled = no filter
			target.session.setScopedModels([]);
		}
		await target.updateAvailableProviderCount();
		target.ui.requestRender();
	};

	target.showSelector((done) => {
		const selector = new ScopedModelsSelectorComponent(
			{
				allModels,
				enabledModelIds: currentEnabledIds,
			},
			{
				onChange: async (enabledIds) => {
					await updateSessionModels(enabledIds);
				},
				onPersist: (enabledIds) => {
					// Persist to settings
					const newPatterns =
						enabledIds === null || enabledIds.length === allModels.length
							? undefined // All enabled = clear filter
							: enabledIds;
					target.settingsManager.setEnabledModels(newPatterns ? [...newPatterns] : undefined);
					target.showStatus("Model selection saved to settings");
				},
				onCancel: () => {
					done();
					target.ui.requestRender();
				},
			},
		);
		return { component: selector, focus: selector };
	});
}
