/**
 * Authentication provider selection for InteractiveMode.
 *
 * This module owns `/login` and `/logout` provider selection. Dialog execution
 * remains delegated through target callbacks so credential prompts and model
 * changes stay in the auth dialog controller.
 */

import { getProviders } from "@mariozechner/pi-ai";
import type { Component, TUI } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import { ExtensionSelectorComponent } from "../components/extension-selector.js";
import { type AuthSelectorProvider, OAuthSelectorComponent } from "../components/oauth-selector.js";

const BEDROCK_PROVIDER_ID = "amazon-bedrock";

const API_KEY_LOGIN_PROVIDERS: Record<string, string> = {
	anthropic: "Anthropic",
	[BEDROCK_PROVIDER_ID]: "Amazon Bedrock",
	"azure-openai-responses": "Azure OpenAI Responses",
	cerebras: "Cerebras",
	deepseek: "DeepSeek",
	fireworks: "Fireworks",
	google: "Google Gemini",
	"google-vertex": "Google Vertex AI",
	groq: "Groq",
	huggingface: "Hugging Face",
	"kimi-coding": "Kimi For Coding",
	mistral: "Mistral",
	minimax: "MiniMax",
	"minimax-cn": "MiniMax (China)",
	opencode: "OpenCode Zen",
	"opencode-go": "OpenCode Go",
	openai: "OpenAI",
	openrouter: "OpenRouter",
	"vercel-ai-gateway": "Vercel AI Gateway",
	xai: "xAI",
	zai: "ZAI",
};

const BUILT_IN_API_KEY_LOGIN_PROVIDERS = new Set(Object.keys(API_KEY_LOGIN_PROVIDERS));
const BUILT_IN_MODEL_PROVIDERS = new Set<string>(getProviders());

export function isApiKeyLoginProvider(
	providerId: string,
	oauthProviderIds: ReadonlySet<string>,
	builtInProviderIds: ReadonlySet<string> = BUILT_IN_MODEL_PROVIDERS,
): boolean {
	if (BUILT_IN_API_KEY_LOGIN_PROVIDERS.has(providerId)) {
		return true;
	}
	if (builtInProviderIds.has(providerId)) {
		return false;
	}
	return !oauthProviderIds.has(providerId);
}

export function getApiKeyProviderDisplayName(providerId: string): string {
	return API_KEY_LOGIN_PROVIDERS[providerId] ?? providerId;
}

export interface AuthSelectorTarget {
	session: AgentSession;
	ui: TUI;
	showApiKeyLoginDialog(providerId: string, providerName: string): Promise<void>;
	showBedrockSetupDialog(providerId: string, providerName: string): void;
	showError(message: string): void;
	showLoginDialog(providerId: string, providerName: string): Promise<void>;
	showSelector(create: (done: () => void) => { component: Component; focus: Component }): void;
	showStatus(message: string): void;
	updateAvailableProviderCount(): Promise<void>;
}

function getLoginProviderOptions(target: AuthSelectorTarget, authType?: "oauth" | "api_key"): AuthSelectorProvider[] {
	const authStorage = target.session.modelRegistry.authStorage;
	const oauthProviders = authStorage.getOAuthProviders();
	const oauthProviderIds = new Set(oauthProviders.map((provider) => provider.id));
	const options: AuthSelectorProvider[] = oauthProviders.map((provider) => ({
		id: provider.id,
		name: provider.name,
		authType: "oauth",
	}));

	const modelProviders = new Set(target.session.modelRegistry.getAll().map((model) => model.provider));
	for (const providerId of modelProviders) {
		if (!isApiKeyLoginProvider(providerId, oauthProviderIds)) {
			continue;
		}
		options.push({
			id: providerId,
			name: getApiKeyProviderDisplayName(providerId),
			authType: "api_key",
		});
	}

	const filteredOptions = authType ? options.filter((option) => option.authType === authType) : options;
	return filteredOptions.sort((a, b) => a.name.localeCompare(b.name));
}

function getLogoutProviderOptions(target: AuthSelectorTarget): AuthSelectorProvider[] {
	const authStorage = target.session.modelRegistry.authStorage;
	const oauthNameById = new Map(authStorage.getOAuthProviders().map((provider) => [provider.id, provider.name]));
	const options: AuthSelectorProvider[] = [];

	for (const providerId of authStorage.list()) {
		const credential = authStorage.get(providerId);
		if (!credential) {
			continue;
		}
		options.push({
			id: providerId,
			name:
				credential.type === "oauth"
					? (oauthNameById.get(providerId) ?? providerId)
					: getApiKeyProviderDisplayName(providerId),
			authType: credential.type,
		});
	}

	return options.sort((a, b) => a.name.localeCompare(b.name));
}

function showLoginAuthTypeSelector(target: AuthSelectorTarget): void {
	const subscriptionLabel = "Use a subscription";
	const apiKeyLabel = "Use an API key";
	target.showSelector((done) => {
		const selector = new ExtensionSelectorComponent(
			"Select authentication method:",
			[subscriptionLabel, apiKeyLabel],
			(option) => {
				done();
				const authType = option === subscriptionLabel ? "oauth" : "api_key";
				showLoginProviderSelector(target, authType);
			},
			() => {
				done();
				target.ui.requestRender();
			},
		);
		return { component: selector, focus: selector };
	});
}

function showLoginProviderSelector(target: AuthSelectorTarget, authType: "oauth" | "api_key"): void {
	const providerOptions = getLoginProviderOptions(target, authType);
	if (providerOptions.length === 0) {
		target.showStatus(
			authType === "oauth" ? "No subscription providers available." : "No API key providers available.",
		);
		return;
	}

	target.showSelector((done) => {
		const selector = new OAuthSelectorComponent(
			"login",
			target.session.modelRegistry.authStorage,
			providerOptions,
			async (providerId: string) => {
				done();
				const providerOption = providerOptions.find((provider) => provider.id === providerId);
				if (!providerOption) return;

				if (providerOption.authType === "oauth") {
					await target.showLoginDialog(providerOption.id, providerOption.name);
				} else if (providerOption.id === BEDROCK_PROVIDER_ID) {
					target.showBedrockSetupDialog(providerOption.id, providerOption.name);
				} else {
					await target.showApiKeyLoginDialog(providerOption.id, providerOption.name);
				}
			},
			() => {
				done();
				showLoginAuthTypeSelector(target);
			},
			(providerId) => target.session.modelRegistry.getProviderAuthStatus(providerId),
		);
		return { component: selector, focus: selector };
	});
}

/** Show the provider selector for login or logout. */
export async function showOAuthSelector(target: AuthSelectorTarget, mode: "login" | "logout"): Promise<void> {
	if (mode === "login") {
		showLoginAuthTypeSelector(target);
		return;
	}

	const providerOptions = getLogoutProviderOptions(target);
	if (providerOptions.length === 0) {
		target.showStatus(
			"No stored credentials to remove. /logout only removes credentials saved by /login; environment variables and models.json config are unchanged.",
		);
		return;
	}

	target.showSelector((done) => {
		const selector = new OAuthSelectorComponent(
			mode,
			target.session.modelRegistry.authStorage,
			providerOptions,
			async (providerId: string) => {
				done();
				const providerOption = providerOptions.find((provider) => provider.id === providerId);
				if (!providerOption) return;

				try {
					target.session.modelRegistry.authStorage.logout(providerOption.id);
					target.session.modelRegistry.refresh();
					await target.updateAvailableProviderCount();
					const message =
						providerOption.authType === "oauth"
							? `Logged out of ${providerOption.name}`
							: `Removed stored API key for ${providerOption.name}. Environment variables and models.json config are unchanged.`;
					target.showStatus(message);
				} catch (error: unknown) {
					target.showError(`Logout failed: ${error instanceof Error ? error.message : String(error)}`);
				}
			},
			() => {
				done();
				target.ui.requestRender();
			},
		);
		return { component: selector, focus: selector };
	});
}
