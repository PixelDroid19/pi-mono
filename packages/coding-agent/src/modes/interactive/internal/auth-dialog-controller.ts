/**
 * Authentication dialog controller for InteractiveMode.
 *
 * This module owns the provider login dialogs and post-auth model selection.
 * InteractiveMode still decides which provider/action was selected, while this
 * controller handles credential prompts, OAuth progress, and UI restoration.
 */

import * as path from "node:path";
import type { Api, Model, OAuthProviderId } from "@mariozechner/pi-ai";
import type { Container, EditorComponent, TUI } from "@mariozechner/pi-tui";
import { getAuthPath, getDocsPath } from "../../../config.js";
import type { AgentSession } from "../../../core/agent-session.js";
import { defaultModelPerProvider } from "../../../core/model-resolver.js";
import type { FooterComponent } from "../components/footer.js";
import { LoginDialogComponent } from "../components/login-dialog.js";
import { theme } from "../theme/theme.js";
import { isUnknownModel } from "./commands.js";

function hasDefaultModelProvider(providerId: string): providerId is keyof typeof defaultModelPerProvider {
	return providerId in defaultModelPerProvider;
}

export interface AuthDialogTarget {
	editor: EditorComponent;
	editorContainer: Container;
	footer: FooterComponent;
	session: AgentSession;
	ui: TUI;
	checkDaxnutsEasterEgg(model: Model<Api>): void;
	maybeWarnAboutAnthropicSubscriptionAuth(model?: Model<Api>): Promise<void>;
	showError(message: string): void;
	showStatus(message: string): void;
	updateAvailableProviderCount(): Promise<void>;
	updateEditorBorderColor(): void;
}

/** complete Provider Authentication for the selected provider. */
export async function completeProviderAuthentication(
	target: AuthDialogTarget,
	providerId: string,
	providerName: string,
	authType: "oauth" | "api_key",
	previousModel: Model<Api> | undefined,
): Promise<void> {
	target.session.modelRegistry.refresh();

	const actionLabel = authType === "oauth" ? `Logged in to ${providerName}` : `Saved API key for ${providerName}`;

	let selectedModel: Model<any> | undefined;
	let selectionError: string | undefined;
	if (isUnknownModel(previousModel)) {
		const availableModels = target.session.modelRegistry.getAvailable();
		const providerModels = availableModels.filter((model) => model.provider === providerId);
		if (!hasDefaultModelProvider(providerId)) {
			selectionError = `${actionLabel}, but no default model is configured for provider "${providerId}". Use /model to select a model.`;
		} else if (providerModels.length === 0) {
			selectionError = `${actionLabel}, but no models are available for that provider. Use /model to select a model.`;
		} else {
			const defaultModelId = defaultModelPerProvider[providerId];
			selectedModel = providerModels.find((model) => model.id === defaultModelId);
			if (!selectedModel) {
				selectionError = `${actionLabel}, but its default model "${defaultModelId}" is not available. Use /model to select a model.`;
			} else {
				try {
					await target.session.setModel(selectedModel);
				} catch (error: unknown) {
					selectedModel = undefined;
					const errorMessage = error instanceof Error ? error.message : String(error);
					selectionError = `${actionLabel}, but selecting its default model failed: ${errorMessage}. Use /model to select a model.`;
				}
			}
		}
	}

	await target.updateAvailableProviderCount();
	target.footer.invalidate();
	target.updateEditorBorderColor();
	if (selectedModel) {
		target.showStatus(`${actionLabel}. Selected ${selectedModel.id}. Credentials saved to ${getAuthPath()}`);
		void target.maybeWarnAboutAnthropicSubscriptionAuth(selectedModel);
		target.checkDaxnutsEasterEgg(selectedModel);
	} else {
		target.showStatus(`${actionLabel}. Credentials saved to ${getAuthPath()}`);
		if (selectionError) {
			target.showError(selectionError);
		} else {
			void target.maybeWarnAboutAnthropicSubscriptionAuth();
		}
	}
}
/** show Bedrock Setup Dialog for the selected provider. */
export function showBedrockSetupDialog(target: AuthDialogTarget, providerId: string, providerName: string): void {
	const restoreEditor = () => {
		target.editorContainer.clear();
		target.editorContainer.addChild(target.editor);
		target.ui.setFocus(target.editor);
		target.ui.requestRender();
	};

	const dialog = new LoginDialogComponent(
		target.ui,
		providerId,
		() => restoreEditor(),
		providerName,
		"Amazon Bedrock setup",
	);
	dialog.showInfo([
		theme.fg("text", "Amazon Bedrock uses AWS credentials instead of a single API key."),
		theme.fg("text", "Configure an AWS profile, IAM keys, bearer token, or role-based credentials."),
		theme.fg("muted", "See:"),
		theme.fg("accent", `  ${path.join(getDocsPath(), "providers.md")}`),
	]);

	target.editorContainer.clear();
	target.editorContainer.addChild(dialog);
	target.ui.setFocus(dialog);
	target.ui.requestRender();
}
/** show Api Key Login Dialog for the selected provider. */
export async function showApiKeyLoginDialog(
	target: AuthDialogTarget,
	providerId: string,
	providerName: string,
): Promise<void> {
	const previousModel = target.session.model;

	const dialog = new LoginDialogComponent(
		target.ui,
		providerId,
		(_success, _message) => {
			// Completion handled below
		},
		providerName,
	);

	target.editorContainer.clear();
	target.editorContainer.addChild(dialog);
	target.ui.setFocus(dialog);
	target.ui.requestRender();

	const restoreEditor = () => {
		target.editorContainer.clear();
		target.editorContainer.addChild(target.editor);
		target.ui.setFocus(target.editor);
		target.ui.requestRender();
	};

	try {
		const apiKey = (await dialog.showPrompt("Enter API key:")).trim();
		if (!apiKey) {
			throw new Error("API key cannot be empty.");
		}

		target.session.modelRegistry.authStorage.set(providerId, { type: "api_key", key: apiKey });

		restoreEditor();
		await completeProviderAuthentication.bind(null, target)(providerId, providerName, "api_key", previousModel);
	} catch (error: unknown) {
		restoreEditor();
		const errorMsg = error instanceof Error ? error.message : String(error);
		if (errorMsg !== "Login cancelled") {
			target.showError(`Failed to save API key for ${providerName}: ${errorMsg}`);
		}
	}
}
/** show Login Dialog for the selected provider. */
export async function showLoginDialog(
	target: AuthDialogTarget,
	providerId: string,
	providerName: string,
): Promise<void> {
	const providerInfo = target.session.modelRegistry.authStorage
		.getOAuthProviders()
		.find((provider) => provider.id === providerId);
	const previousModel = target.session.model;

	// Providers that use callback servers (can paste redirect URL)
	const usesCallbackServer = providerInfo?.usesCallbackServer ?? false;

	// Create login dialog component
	const dialog = new LoginDialogComponent(
		target.ui,
		providerId,
		(_success, _message) => {
			// Completion handled below
		},
		providerName,
	);

	// Show dialog in editor container
	target.editorContainer.clear();
	target.editorContainer.addChild(dialog);
	target.ui.setFocus(dialog);
	target.ui.requestRender();

	// Promise for manual code input (racing with callback server)
	let manualCodeResolve: ((code: string) => void) | undefined;
	let manualCodeReject: ((err: Error) => void) | undefined;
	const manualCodePromise = new Promise<string>((resolve, reject) => {
		manualCodeResolve = resolve;
		manualCodeReject = reject;
	});

	// Restore editor helper
	const restoreEditor = () => {
		target.editorContainer.clear();
		target.editorContainer.addChild(target.editor);
		target.ui.setFocus(target.editor);
		target.ui.requestRender();
	};

	try {
		await target.session.modelRegistry.authStorage.login(providerId as OAuthProviderId, {
			onAuth: (info: { url: string; instructions?: string }) => {
				dialog.showAuth(info.url, info.instructions);

				if (usesCallbackServer) {
					// Show input for manual paste, racing with callback
					dialog
						.showManualInput("Paste redirect URL below, or complete login in browser:")
						.then((value) => {
							if (value && manualCodeResolve) {
								manualCodeResolve(value);
								manualCodeResolve = undefined;
							}
						})
						.catch(() => {
							if (manualCodeReject) {
								manualCodeReject(new Error("Login cancelled"));
								manualCodeReject = undefined;
							}
						});
				} else if (providerId === "github-copilot") {
					// GitHub Copilot polls after onAuth
					dialog.showWaiting("Waiting for browser authentication...");
				}
				// For Anthropic: onPrompt is called immediately after
			},

			onPrompt: async (prompt: { message: string; placeholder?: string }) => {
				return dialog.showPrompt(prompt.message, prompt.placeholder);
			},

			onProgress: (message: string) => {
				dialog.showProgress(message);
			},

			onManualCodeInput: () => manualCodePromise,

			signal: dialog.signal,
		});

		// Success
		restoreEditor();
		await completeProviderAuthentication.bind(null, target)(providerId, providerName, "oauth", previousModel);
	} catch (error: unknown) {
		restoreEditor();
		const errorMsg = error instanceof Error ? error.message : String(error);
		if (errorMsg !== "Login cancelled") {
			target.showError(`Failed to login to ${providerName}: ${errorMsg}`);
		}
	}
}
