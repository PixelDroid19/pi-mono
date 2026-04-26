/**
 * Model selection and authentication actions for InteractiveMode.
 *
 * This module isolates the model/authentication decisions that live near the
 * bottom of InteractiveMode. The target interface intentionally exposes only
 * the state transitions and rendering hooks needed by these actions, so the
 * main class can remain a thin facade without leaking its full private state.
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import type { AgentSession } from "../../../core/agent-session.js";
import type { FooterDataProvider } from "../../../core/footer-data-provider.js";
import { findExactModelReferenceMatch } from "../../../core/model-resolver.js";
import type { FooterComponent } from "../components/footer.js";

const ANTHROPIC_SUBSCRIPTION_AUTH_WARNING =
	"Anthropic subscription auth is active. Third-party harness usage draws from extra usage and is billed per token, not your Claude plan limits. Manage extra usage at https://claude.ai/settings/usage.";

function isAnthropicSubscriptionAuthKey(apiKey: string | undefined): boolean {
	return typeof apiKey === "string" && apiKey.startsWith("sk-ant-oat");
}

export interface ModelAuthActionsTarget {
	anthropicSubscriptionWarningShown: boolean;
	footer: FooterComponent;
	footerDataProvider: FooterDataProvider;
	session: AgentSession;
	checkDaxnutsEasterEgg(model: { provider: string; id: string }): void;
	showError(message: string): void;
	showModelSelector(initialSearchInput?: string): void;
	showStatus(message: string): void;
	showWarning(message: string): void;
	updateEditorBorderColor(): void;
}

/** Return the models visible to the current session, falling back to the registry when no scope is active. */
export async function getModelCandidates(target: ModelAuthActionsTarget): Promise<Model<Api>[]> {
	if (target.session.scopedModels.length > 0) {
		return target.session.scopedModels.map((scoped) => scoped.model as Model<Api>);
	}

	target.session.modelRegistry.refresh();
	try {
		return (await target.session.modelRegistry.getAvailable()) as Model<Api>[];
	} catch {
		return [];
	}
}

/** Resolve a typed model reference exactly as `/model <provider/model>` expects. */
export async function findExactModelMatch(
	target: ModelAuthActionsTarget,
	searchTerm: string,
): Promise<Model<Api> | undefined> {
	const models = await getModelCandidates(target);
	return findExactModelReferenceMatch(searchTerm, models);
}

/** Update the footer's provider-count indicator from the currently available models. */
export async function updateAvailableProviderCount(target: ModelAuthActionsTarget): Promise<void> {
	const models = await getModelCandidates(target);
	const uniqueProviders = new Set(models.map((model) => model.provider));
	target.footerDataProvider.setAvailableProviderCount(uniqueProviders.size);
}

/** Show the Anthropic subscription warning once when the selected credential can incur separate usage. */
export async function maybeWarnAboutAnthropicSubscriptionAuth(
	target: ModelAuthActionsTarget,
	model: Model<Api> | undefined = target.session.model as Model<Api> | undefined,
): Promise<void> {
	if (target.anthropicSubscriptionWarningShown) {
		return;
	}
	if (!model || model.provider !== "anthropic") {
		return;
	}

	const storedCredential = target.session.modelRegistry.authStorage.get("anthropic");
	if (storedCredential?.type === "oauth") {
		target.anthropicSubscriptionWarningShown = true;
		target.showWarning(ANTHROPIC_SUBSCRIPTION_AUTH_WARNING);
		return;
	}

	try {
		const apiKey = await target.session.modelRegistry.getApiKeyForProvider(model.provider);
		if (!isAnthropicSubscriptionAuthKey(apiKey)) {
			return;
		}
		target.anthropicSubscriptionWarningShown = true;
		target.showWarning(ANTHROPIC_SUBSCRIPTION_AUTH_WARNING);
	} catch {
		// Warning-only path: unavailable auth state should not block model selection.
	}
}

/** Execute `/model`, either switching directly on an exact match or opening the selector. */
export async function handleModelCommand(target: ModelAuthActionsTarget, searchTerm?: string): Promise<void> {
	if (!searchTerm) {
		target.showModelSelector();
		return;
	}

	const model = await findExactModelMatch(target, searchTerm);
	if (!model) {
		target.showModelSelector(searchTerm);
		return;
	}

	try {
		await target.session.setModel(model);
		target.footer.invalidate();
		target.updateEditorBorderColor();
		target.showStatus(`Model: ${model.id}`);
		void maybeWarnAboutAnthropicSubscriptionAuth(target, model);
		target.checkDaxnutsEasterEgg(model);
	} catch (error) {
		target.showError(error instanceof Error ? error.message : String(error));
	}
}
