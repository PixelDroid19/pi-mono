/**
 * Runtime session orchestration for InteractiveMode.
 *
 * This module groups session replacement, extension rebinding, runtime setting
 * propagation, and extension shortcut wiring. Keeping these transitions here
 * makes `InteractiveMode` a thin facade while preserving existing runtime
 * behavior and extension hook ordering.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { EditorComponent } from "@mariozechner/pi-tui";
import { type KeyId, type Loader, matchesKey } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { AgentSessionRuntime } from "../../../core/agent-session-runtime.js";
import type {
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionRunner,
	ExtensionUIContext,
} from "../../../core/extensions/index.js";
import type { FooterDataProvider } from "../../../core/footer-data-provider.js";
import type { KeybindingsConfig } from "../../../core/keybindings.js";
import { formatMissingSessionCwdPrompt, MissingSessionCwdError } from "../../../core/session-cwd.js";
import type { SessionManager } from "../../../core/session-manager.js";
import type { SettingsManager } from "../../../core/settings-manager.js";
import { setRegisteredThemes, stopThemeWatcher } from "../theme/theme.js";

export interface SessionRuntimeTarget {
	loadingAnimation: Loader | undefined;
	runtimeHost: AgentSessionRuntime;
	session: AgentSession;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	footerDataProvider: FooterDataProvider;
	footer: {
		setSession(session: AgentSession): void;
		setAutoCompactEnabled(enabled: boolean): void;
		invalidate(): void;
	};
	keybindings: { getEffectiveConfig(): KeybindingsConfig };
	ui: {
		requestRender(): void;
		setShowHardwareCursor(enabled: boolean): void;
		setClearOnShrink(enabled: boolean): void;
	};
	editor: EditorComponent;
	defaultEditor: {
		onExtensionShortcut?: (data: string) => boolean;
		setPaddingX(paddingX: number): void;
		setAutocompleteMaxVisible(maxVisible: number): void;
		setText(text: string): void;
		getText(): string;
	};
	statusContainer: { clear(): void };
	chatContainer: { clear(): void };
	pendingMessagesContainer: { clear(): void };
	shutdownRequested: boolean;
	hideThinkingBlock: boolean;
	unsubscribe: (() => void) | undefined;
	compactionQueuedMessages: Array<{ text: string; mode: "steer" | "followUp" }>;
	streamingComponent: unknown;
	streamingMessage: AgentMessage | undefined;
	pendingTools: Map<string, unknown>;
	showStatus(message: string): void;
	showError(message: string): void;
	showExtensionError(extensionPath: string, error: string, stack?: string): void;
	showExtensionConfirm(title: string, message: string): Promise<boolean>;
	showLoadedResources(options?: { force: boolean; showDiagnosticsWhenQuiet?: boolean }): void;
	showStartupNoticesIfNeeded(): void;
	setupAutocompleteProvider(): void;
	setupExtensionShortcuts(extensionRunner: ExtensionRunner): void;
	createExtensionUIContext(): ExtensionUIContext;
	renderInitialMessages(): void;
	renderCurrentSessionState(): void;
	updateEditorBorderColor(): void;
	updateTerminalTitle(): void;
	updateAvailableProviderCount(): Promise<void>;
	subscribeToAgent(): void;
	bindCurrentSessionExtensions(): Promise<void>;
	applyRuntimeSettings(): void;
	handleReloadCommand(): Promise<void>;
	shutdown(): Promise<void>;
	handleFatalRuntimeError(prefix: string, error: unknown): Promise<never>;
	flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void>;
	stop(): void;
}

/**
 * Prompt whether an unavailable persisted session cwd should be replaced by the
 * current fallback cwd.
 */
export async function promptForMissingSessionCwd(
	target: Pick<SessionRuntimeTarget, "showExtensionConfirm">,
	error: MissingSessionCwdError,
): Promise<string | undefined> {
	const confirmed = await target.showExtensionConfirm(
		"Session cwd not found",
		formatMissingSessionCwdPrompt(error.issue),
	);
	return confirmed ? error.issue.fallbackCwd : undefined;
}

/**
 * Bind extension runtime hooks and command-context actions for the current session.
 */
export async function bindCurrentSessionExtensions(target: SessionRuntimeTarget): Promise<void> {
	const uiContext = target.createExtensionUIContext();
	await target.session.bindExtensions({
		uiContext,
		commandContextActions: {
			waitForIdle: () => target.session.agent.waitForIdle(),
			newSession: async (options) => {
				if (target.loadingAnimation) {
					target.loadingAnimation.stop();
					target.loadingAnimation = undefined;
				}
				target.statusContainer.clear();
				try {
					const result = await target.runtimeHost.newSession(options);
					if (!result.cancelled) {
						target.renderCurrentSessionState();
						target.ui.requestRender();
					}
					return result;
				} catch (error: unknown) {
					return target.handleFatalRuntimeError("Failed to create session", error);
				}
			},
			fork: async (entryId, options) => {
				try {
					const result = await target.runtimeHost.fork(entryId, options);
					if (!result.cancelled) {
						target.renderCurrentSessionState();
						target.editor.setText(result.selectedText ?? "");
						target.showStatus("Forked to new session");
					}
					return { cancelled: result.cancelled };
				} catch (error: unknown) {
					return target.handleFatalRuntimeError("Failed to fork session", error);
				}
			},
			navigateTree: async (targetId, options) => {
				const result = await target.session.navigateTree(targetId, {
					summarize: options?.summarize,
					customInstructions: options?.customInstructions,
					replaceInstructions: options?.replaceInstructions,
					label: options?.label,
				});
				if (result.cancelled) {
					return { cancelled: true };
				}

				target.chatContainer.clear();
				target.renderInitialMessages();
				if (result.editorText && !target.editor.getText().trim()) {
					target.editor.setText(result.editorText);
				}
				target.showStatus("Navigated to selected point");
				void target.flushCompactionQueue({ willRetry: false });
				return { cancelled: false };
			},
			switchSession: async (sessionPath, options) => {
				return handleResumeSession(target, sessionPath, options);
			},
			reload: async () => {
				await target.handleReloadCommand();
			},
		},
		shutdownHandler: () => {
			target.shutdownRequested = true;
			if (!target.session.isStreaming) {
				void target.shutdown();
			}
		},
		onError: (error) => {
			target.showExtensionError(error.extensionPath, error.error, error.stack);
		},
	});

	setRegisteredThemes(target.session.resourceLoader.getThemes().themes);
	target.setupAutocompleteProvider();

	const extensionRunner = target.session.extensionRunner;
	target.setupExtensionShortcuts(extensionRunner);
	target.showLoadedResources({ force: false, showDiagnosticsWhenQuiet: true });
	target.showStartupNoticesIfNeeded();
}

/**
 * Apply settings that affect the active session footer, editor, and TUI behavior.
 */
export function applyRuntimeSettings(target: SessionRuntimeTarget): void {
	target.footer.setSession(target.session);
	target.footer.setAutoCompactEnabled(target.session.autoCompactionEnabled);
	target.footerDataProvider.setCwd(target.sessionManager.getCwd());
	target.hideThinkingBlock = target.settingsManager.getHideThinkingBlock();
	target.ui.setShowHardwareCursor(target.settingsManager.getShowHardwareCursor());
	target.ui.setClearOnShrink(target.settingsManager.getClearOnShrink());

	const editorPaddingX = target.settingsManager.getEditorPaddingX();
	const autocompleteMaxVisible = target.settingsManager.getAutocompleteMaxVisible();
	target.defaultEditor.setPaddingX(editorPaddingX);
	target.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
	if (target.editor !== target.defaultEditor) {
		target.editor.setPaddingX?.(editorPaddingX);
		target.editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
	}
}

/**
 * Rebind runtime state after session replacement or reload.
 */
export async function rebindCurrentSession(target: SessionRuntimeTarget): Promise<void> {
	target.unsubscribe?.();
	target.unsubscribe = undefined;
	applyRuntimeSettings(target);
	await bindCurrentSessionExtensions(target);
	target.subscribeToAgent();
	await target.updateAvailableProviderCount();
	target.updateEditorBorderColor();
	target.updateTerminalTitle();
}

/**
 * Render a fatal runtime error and terminate the interactive process.
 */
export async function handleFatalRuntimeError(
	target: Pick<SessionRuntimeTarget, "showError" | "stop">,
	prefix: string,
	error: unknown,
): Promise<never> {
	const message = error instanceof Error ? error.message : String(error);
	target.showError(`${prefix}: ${message}`);
	stopThemeWatcher();
	target.stop();
	process.exit(1);
}

/**
 * Reset rendered session state after a session switch/new/fork transition.
 */
export function renderCurrentSessionState(target: SessionRuntimeTarget): void {
	target.chatContainer.clear();
	target.pendingMessagesContainer.clear();
	target.compactionQueuedMessages = [];
	target.streamingComponent = undefined;
	target.streamingMessage = undefined;
	target.pendingTools.clear();
	target.renderInitialMessages();
}

/**
 * Install extension-provided keyboard shortcuts on the default editor.
 */
export function setupExtensionShortcuts(target: SessionRuntimeTarget, extensionRunner: ExtensionRunner): void {
	const shortcuts = extensionRunner.getShortcuts(target.keybindings.getEffectiveConfig());
	if (shortcuts.size === 0) return;

	const createContext = (): ExtensionContext => ({
		ui: target.createExtensionUIContext(),
		hasUI: true,
		cwd: target.sessionManager.getCwd(),
		sessionManager: target.sessionManager,
		modelRegistry: target.session.modelRegistry,
		model: target.session.model as Model<Api> | undefined,
		isIdle: () => !target.session.isStreaming,
		signal: target.session.agent.signal,
		abort: () => target.session.abort(),
		hasPendingMessages: () => target.session.pendingMessageCount > 0,
		shutdown: () => {
			target.shutdownRequested = true;
		},
		getContextUsage: () => target.session.getContextUsage(),
		compact: (options) => {
			void (async () => {
				try {
					const result = await target.session.compact(options?.customInstructions);
					options?.onComplete?.(result);
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));
					options?.onError?.(err);
				}
			})();
		},
		getSystemPrompt: () => target.session.systemPrompt,
	});

	target.defaultEditor.onExtensionShortcut = (data: string) => {
		for (const [shortcutStr, shortcut] of shortcuts) {
			if (matchesKey(data, shortcutStr as KeyId)) {
				Promise.resolve(shortcut.handler(createContext())).catch((error) => {
					target.showError(`Shortcut handler error: ${error instanceof Error ? error.message : String(error)}`);
				});
				return true;
			}
		}
		return false;
	};
}

/**
 * Duplicate the current leaf into a new session branch and refresh rendered state.
 */
export async function handleCloneCommand(
	target: Pick<
		SessionRuntimeTarget,
		"sessionManager" | "runtimeHost" | "renderCurrentSessionState" | "editor" | "showStatus" | "showError" | "ui"
	>,
): Promise<void> {
	const leafId = target.sessionManager.getLeafId();
	if (!leafId) {
		target.showStatus("Nothing to clone yet");
		return;
	}

	try {
		const result = await target.runtimeHost.fork(leafId, { position: "at" });
		if (result.cancelled) {
			target.ui.requestRender();
			return;
		}
		target.renderCurrentSessionState();
		target.editor.setText("");
		target.showStatus("Cloned to new session");
	} catch (error: unknown) {
		target.showError(error instanceof Error ? error.message : String(error));
	}
}

/**
 * Resume a persisted session file, with fallback when the stored cwd no longer exists.
 */
export async function handleResumeSession(
	target: Pick<
		SessionRuntimeTarget,
		| "loadingAnimation"
		| "statusContainer"
		| "runtimeHost"
		| "renderCurrentSessionState"
		| "showStatus"
		| "showExtensionConfirm"
		| "handleFatalRuntimeError"
	>,
	sessionPath: string,
	options?: Parameters<ExtensionCommandContext["switchSession"]>[1],
): Promise<{ cancelled: boolean }> {
	if (target.loadingAnimation) {
		target.loadingAnimation.stop();
		target.loadingAnimation = undefined;
	}
	target.statusContainer.clear();

	try {
		const result = await target.runtimeHost.switchSession(sessionPath, { withSession: options?.withSession });
		if (result.cancelled) return result;
		target.renderCurrentSessionState();
		target.showStatus("Resumed session");
		return result;
	} catch (error: unknown) {
		if (error instanceof MissingSessionCwdError) {
			const selectedCwd = await promptForMissingSessionCwd(target, error);
			if (!selectedCwd) {
				target.showStatus("Resume cancelled");
				return { cancelled: true };
			}
			const result = await target.runtimeHost.switchSession(sessionPath, {
				cwdOverride: selectedCwd,
				withSession: options?.withSession,
			});
			if (result.cancelled) return result;
			target.renderCurrentSessionState();
			target.showStatus("Resumed session in current cwd");
			return result;
		}
		return target.handleFatalRuntimeError("Failed to resume session", error);
	}
}
