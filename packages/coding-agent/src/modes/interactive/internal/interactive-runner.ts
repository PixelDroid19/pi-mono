/**
 * Main InteractiveMode execution loop.
 *
 * The class owns TUI state and public compatibility wrappers; this module owns
 * startup side effects and the long-running prompt loop. Keeping the loop here
 * makes the class easier to scan without changing how startup warnings, initial
 * messages, background checks, and prompt errors are ordered.
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import type { AgentSession } from "../../../core/agent-session.js";
import type { InteractiveModeOptions } from "./interactive-mode-impl.js";

export interface InteractiveRunnerTarget {
	options: InteractiveModeOptions;
	session: AgentSession;
	checkForNewVersion(): Promise<string | undefined>;
	checkForPackageUpdates(): Promise<string[]>;
	checkTmuxKeyboardSetup(): Promise<string | undefined>;
	getUserInput(): Promise<string>;
	init(): Promise<void>;
	maybeWarnAboutAnthropicSubscriptionAuth(model?: Model<Api>): Promise<void>;
	showError(errorMessage: string): void;
	showNewVersionNotification(newVersion: string): void;
	showPackageUpdateNotification(packages: string[]): void;
	showWarning(warningMessage: string): void;
}

function getPromptErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Unknown error occurred";
}

async function promptSafely(
	target: Pick<InteractiveRunnerTarget, "session" | "showError">,
	message: string,
	options?: Parameters<AgentSession["prompt"]>[1],
): Promise<void> {
	try {
		await target.session.prompt(message, options);
	} catch (error: unknown) {
		target.showError(getPromptErrorMessage(error));
	}
}

/** Run startup checks, initial prompts, and the blocking user-input loop. */
export async function runInteractiveMode(target: InteractiveRunnerTarget): Promise<void> {
	await target.init();

	target.checkForNewVersion().then((newVersion) => {
		if (newVersion) {
			target.showNewVersionNotification(newVersion);
		}
	});

	target.checkForPackageUpdates().then((updates) => {
		if (updates.length > 0) {
			target.showPackageUpdateNotification(updates);
		}
	});

	target.checkTmuxKeyboardSetup().then((warning) => {
		if (warning) {
			target.showWarning(warning);
		}
	});

	const { migratedProviders, modelFallbackMessage, initialMessage, initialImages, initialMessages } = target.options;

	if (migratedProviders && migratedProviders.length > 0) {
		target.showWarning(`Migrated credentials to auth.json: ${migratedProviders.join(", ")}`);
	}

	const modelsJsonError = target.session.modelRegistry.getError();
	if (modelsJsonError) {
		target.showError(`models.json error: ${modelsJsonError}`);
	}

	if (modelFallbackMessage) {
		target.showWarning(modelFallbackMessage);
	}

	void target.maybeWarnAboutAnthropicSubscriptionAuth();

	if (initialMessage) {
		await promptSafely(target, initialMessage, { images: initialImages });
	}

	if (initialMessages) {
		for (const message of initialMessages) {
			await promptSafely(target, message);
		}
	}

	while (true) {
		const userInput = await target.getUserInput();
		await promptSafely(target, userInput);
	}
}
