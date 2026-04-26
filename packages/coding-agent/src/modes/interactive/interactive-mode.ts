import * as path from "node:path";
/**
 * Interactive mode for the coding agent.
 * Handles TUI rendering and user interaction, delegating business logic to AgentSession.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Api, AssistantMessage, ImageContent, Model } from "@mariozechner/pi-ai";
import type {
	AutocompleteProvider,
	EditorComponent,
	EditorTheme,
	Keybinding,
	MarkdownTheme,
	OverlayHandle,
	OverlayOptions,
} from "@mariozechner/pi-tui";
import {
	type Component,
	Container,
	type Loader,
	type LoaderIndicatorOptions,
	ProcessTerminal,
	type Spacer,
	setKeybindings,
	type Text,
	TUI,
} from "@mariozechner/pi-tui";
import { APP_TITLE, getAgentDir, VERSION } from "../../config.js";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session.js";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.js";
import type {
	AutocompleteProviderFactory,
	ExtensionCommandContext,
	ExtensionRunner,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
} from "../../core/extensions/index.js";
import { FooterDataProvider } from "../../core/footer-data-provider.js";
import { type AppKeybinding, KeybindingsManager } from "../../core/keybindings.js";
import type { MissingSessionCwdError } from "../../core/session-cwd.js";
import type { SessionContext } from "../../core/session-manager.js";
import type { SourceInfo } from "../../core/source-info.js";
import { isInstallTelemetryEnabled } from "../../core/telemetry.js";
import type { AssistantMessageComponent } from "./components/assistant-message.js";
import type { BashExecutionComponent } from "./components/bash-execution.js";
import type { CountdownTimer } from "./components/countdown-timer.js";
import { CustomEditor } from "./components/custom-editor.js";
import type { ExtensionEditorComponent } from "./components/extension-editor.js";
import type { ExtensionInputComponent } from "./components/extension-input.js";
import type { ExtensionSelectorComponent } from "./components/extension-selector.js";
import { FooterComponent } from "./components/footer.js";
import { keyText } from "./components/keybinding-hints.js";
import type { ToolExecutionComponent } from "./components/tool-execution.js";
import {
	showApiKeyLoginDialog as _showApiKeyLoginDialog,
	showBedrockSetupDialog as _showBedrockSetupDialog,
	showLoginDialog as _showLoginDialog,
	type AuthDialogTarget,
} from "./internal/auth-dialog-controller.js";
import {
	showOAuthSelector as _showOAuthSelector,
	type AuthSelectorTarget,
	getApiKeyProviderDisplayName,
	isApiKeyLoginProvider,
} from "./internal/auth-selector-controller.js";
import { handleBashCommand as _handleBashCommand, type InteractiveBashCommandTarget } from "./internal/bash-command.js";
import {
	checkForNewVersion as _checkForNewVersion,
	getChangelogForDisplay as _getChangelogForDisplay,
	reportInstallTelemetry as _reportInstallTelemetry,
} from "./internal/bootstrap.js";
import {
	addExtensionTerminalInputListener as _addExtensionTerminalInputListener,
	clearExtensionTerminalInputListeners as _clearExtensionTerminalInputListeners,
	createExtensionUIContext as _createExtensionUIContext,
	createWorkingLoader as _createWorkingLoader,
	hideExtensionEditor as _hideExtensionEditor,
	hideExtensionInput as _hideExtensionInput,
	hideExtensionSelector as _hideExtensionSelector,
	renderWidgets as _renderWidgets,
	resetExtensionUI as _resetExtensionUI,
	setCustomEditorComponent as _setCustomEditorComponent,
	showExtensionConfirm as _showExtensionConfirm,
	showExtensionCustom as _showExtensionCustom,
	showExtensionEditor as _showExtensionEditor,
	showExtensionError as _showExtensionError,
	showExtensionInput as _showExtensionInput,
	showExtensionNotify as _showExtensionNotify,
	showExtensionSelector as _showExtensionSelector,
	stopWorkingLoader as _stopWorkingLoader,
	type ExtensionUiTarget,
} from "./internal/extension-ui-controller.js";
import {
	createBaseAutocompleteProvider as _createBaseAutocompleteProvider,
	initInteractiveMode as _initInteractiveMode,
	setupAutocompleteProvider as _setupAutocompleteProvider,
	showStartupNoticesIfNeeded as _showStartupNoticesIfNeeded,
	type InteractiveStartupTarget,
} from "./internal/interactive-startup.js";
import { setupKeyHandlers as _setupKeyHandlers, type KeyHandlerTarget } from "./internal/key-handler-controller.js";
import {
	showLoadedResources as _showLoadedResources,
	type LoadedResourcesHost,
	type ShowLoadedResourcesOptions,
} from "./internal/loaded-resources.js";
import {
	checkDaxnutsEasterEgg as _checkDaxnutsEasterEgg,
	handleArminSaysHi as _handleArminSaysHi,
	handleDaxnuts as _handleDaxnuts,
	handleDementedDelves as _handleDementedDelves,
	handleHotkeysCommand as _handleHotkeysCommand,
	type LowerCommandActionsTarget,
} from "./internal/lower-command-actions.js";
import {
	findExactModelMatch as _findExactModelMatch,
	getModelCandidates as _getModelCandidates,
	handleModelCommand as _handleModelCommand,
	maybeWarnAboutAnthropicSubscriptionAuth as _maybeWarnAboutAnthropicSubscriptionAuth,
	updateAvailableProviderCount as _updateAvailableProviderCount,
	type ModelAuthActionsTarget,
} from "./internal/model-auth-actions.js";
import {
	showModelSelector as _showModelSelector,
	showModelsSelector as _showModelsSelector,
	type ModelSelectorTarget,
} from "./internal/model-selector-controller.js";
import {
	showTreeSelector as _showTreeSelector,
	showUserMessageSelector as _showUserMessageSelector,
	type NavigationSelectorTarget,
} from "./internal/navigation-selector-controller.js";
import { handleReloadCommand as _handleReloadCommand, type ReloadCommandTarget } from "./internal/reload-command.js";
import { getAutocompleteSourceTag as _getAutocompleteSourceTag } from "./internal/resource-display.js";
import {
	checkForPackageUpdates as _checkForPackageUpdates,
	checkTmuxKeyboardSetup as _checkTmuxKeyboardSetup,
} from "./internal/session-actions.js";
import {
	handleChangelogCommand as _handleChangelogCommand,
	handleClearCommand as _handleClearCommand,
	handleCompactCommand as _handleCompactCommand,
	handleCopyCommand as _handleCopyCommand,
	handleDebugCommand as _handleDebugCommand,
	handleExportCommand as _handleExportCommand,
	handleImportCommand as _handleImportCommand,
	handleNameCommand as _handleNameCommand,
	handleSessionCommand as _handleSessionCommand,
	type SessionCommandTarget,
} from "./internal/session-command-handlers.js";
import {
	checkShutdownRequested as _checkShutdownRequested,
	cycleModel as _cycleModel,
	cycleThinkingLevel as _cycleThinkingLevel,
	handleCtrlC as _handleCtrlC,
	handleCtrlD as _handleCtrlD,
	handleCtrlZ as _handleCtrlZ,
	handleDequeue as _handleDequeue,
	handleFollowUp as _handleFollowUp,
	openExternalEditor as _openExternalEditor,
	registerSignalHandlers as _registerSignalHandlers,
	setToolsExpanded as _setToolsExpanded,
	shutdown as _shutdown,
	toggleThinkingBlockVisibility as _toggleThinkingBlockVisibility,
	unregisterSignalHandlers as _unregisterSignalHandlers,
	updateEditorBorderColor as _updateEditorBorderColor,
	type SessionControlTarget,
} from "./internal/session-control-actions.js";
import {
	handleInteractiveEvent as _handleInteractiveEvent,
	type InteractiveEventTarget,
} from "./internal/session-event-renderer.js";
import {
	clearQueuedMessages as _clearQueuedMessages,
	flushPendingBashComponents as _flushPendingBashComponents,
	queueCompactionMessage as _queueCompactionMessage,
	readAllQueuedMessages as _readAllQueuedMessages,
	restoreQueuedMessagesToEditor as _restoreQueuedMessagesToEditor,
	showError as _showInteractiveError,
	showWarning as _showInteractiveWarning,
	showNewVersionNotification as _showNewVersionNotification,
	showPackageUpdateNotification as _showPackageUpdateNotification,
	updatePendingMessagesDisplay as _updatePendingMessagesDisplay,
	type SessionFeedbackTarget,
} from "./internal/session-feedback-controller.js";
import {
	flushCompactionQueuedMessages as _flushCompactionQueuedMessages,
	isExtensionCommandText as _isExtensionCommandText,
	type CompactionQueuedMessage,
} from "./internal/session-queue.js";
import {
	applyRuntimeSettings as _applyRuntimeSettings,
	bindCurrentSessionExtensions as _bindCurrentSessionExtensions,
	handleCloneCommand as _handleCloneCommand,
	handleFatalRuntimeError as _handleFatalRuntimeError,
	handleResumeSession as _handleResumeSession,
	promptForMissingSessionCwd as _promptForMissingSessionCwd,
	rebindCurrentSession as _rebindCurrentSession,
	renderCurrentSessionState as _renderCurrentSessionState,
	setupExtensionShortcuts as _setupExtensionShortcuts,
	type SessionRuntimeTarget,
} from "./internal/session-runtime-controller.js";
import {
	showSessionSelector as _showSessionSelector,
	type SessionSelectorTarget,
} from "./internal/session-selector-controller.js";
import {
	addMessageToChat as _addMessageToChat,
	rebuildChatFromMessages as _rebuildChatFromMessages,
	renderInitialMessages as _renderInitialMessages,
	renderSessionContext as _renderSessionContext,
	showStatus as _showStatus,
	type SessionViewTarget,
} from "./internal/session-view-controller.js";
import {
	showSettingsSelector as _showSettingsSelector,
	type SettingsSelectorTarget,
} from "./internal/settings-selector-controller.js";
import {
	handleShareCommand as _handleShareCommand,
	type InteractiveShareCommandTarget,
} from "./internal/share-command.js";
import {
	handleSkillsCommand as _handleSkillsCommand,
	type SkillSelectorTarget,
} from "./internal/skill-selector-controller.js";
import { handleEditorSubmit as _handleEditorSubmit, type InteractiveSubmitTarget } from "./internal/submit-handler.js";
import { getEditorTheme, getMarkdownTheme, initTheme, setRegisteredThemes, type Theme } from "./theme/theme.js";

export { getApiKeyProviderDisplayName, isApiKeyLoginProvider };

/**
 * Options for InteractiveMode initialization.
 */
export interface InteractiveModeOptions {
	/** Providers that were migrated to auth.json (shows warning) */
	migratedProviders?: string[];
	/** Warning message if session model couldn't be restored */
	modelFallbackMessage?: string;
	/** Initial message to send on startup (can include @file content) */
	initialMessage?: string;
	/** Images to attach to the initial message */
	initialImages?: ImageContent[];
	/** Additional messages to send after the initial message */
	initialMessages?: string[];
	/** Force verbose startup (overrides quietStartup setting) */
	verbose?: boolean;
}

export class InteractiveMode {
	protected runtimeHost: AgentSessionRuntime;
	protected ui: TUI;
	protected chatContainer: Container;
	protected pendingMessagesContainer: Container;
	protected statusContainer: Container;
	protected defaultEditor: CustomEditor;
	protected editor: EditorComponent;
	protected autocompleteProvider: AutocompleteProvider | undefined;
	protected autocompleteProviderWrappers: AutocompleteProviderFactory[] = [];
	protected fdPath: string | undefined;
	protected editorContainer: Container;
	protected footer: FooterComponent;
	protected footerDataProvider: FooterDataProvider;
	// Stored so the same manager can be injected into custom editors, selectors, and extension UI.
	protected keybindings: KeybindingsManager;
	protected version: string;
	protected isInitialized = false;
	protected onInputCallback?: (text: string) => void;
	protected loadingAnimation: Loader | undefined = undefined;
	protected workingMessage: string | undefined = undefined;
	protected workingVisible = true;
	protected workingIndicatorOptions: LoaderIndicatorOptions | undefined = undefined;
	protected readonly defaultWorkingMessage = "Working...";
	protected readonly defaultHiddenThinkingLabel = "Thinking...";
	protected hiddenThinkingLabel = this.defaultHiddenThinkingLabel;

	protected lastSigintTime = 0;
	protected lastEscapeTime = 0;
	protected changelogMarkdown: string | undefined = undefined;
	protected startupNoticesShown = false;
	protected anthropicSubscriptionWarningShown = false;

	// Status line tracking (for mutating immediately-sequential status updates)
	protected lastStatusSpacer: Spacer | undefined = undefined;
	protected lastStatusText: Text | undefined = undefined;

	// Streaming message tracking
	protected streamingComponent: AssistantMessageComponent | undefined = undefined;
	protected streamingMessage: AssistantMessage | undefined = undefined;

	// Tool execution tracking: toolCallId -> component
	protected pendingTools = new Map<string, ToolExecutionComponent>();

	// Tool output expansion state
	protected toolOutputExpanded = false;

	// Thinking block visibility state
	protected hideThinkingBlock = false;

	// Skill commands: command name -> skill file path
	protected skillCommands = new Map<string, string>();

	// Agent subscription unsubscribe function
	protected unsubscribe?: () => void;
	protected signalCleanupHandlers: Array<() => void> = [];

	// Track if editor is in bash mode (text starts with !)
	protected isBashMode = false;

	// Track current bash execution component
	protected bashComponent: BashExecutionComponent | undefined = undefined;

	// Track pending bash components (shown in pending area, moved to chat on submit)
	protected pendingBashComponents: BashExecutionComponent[] = [];

	// Auto-compaction state
	protected autoCompactionLoader: Loader | undefined = undefined;
	protected autoCompactionEscapeHandler?: () => void;

	// Auto-retry state
	protected retryLoader: Loader | undefined = undefined;
	protected retryCountdown: CountdownTimer | undefined = undefined;
	protected retryEscapeHandler?: () => void;

	// Messages queued while compaction is running
	protected compactionQueuedMessages: CompactionQueuedMessage[] = [];

	// Shutdown state
	protected shutdownRequested = false;

	// Extension UI state
	protected extensionSelector: ExtensionSelectorComponent | undefined = undefined;
	protected extensionInput: ExtensionInputComponent | undefined = undefined;
	protected extensionEditor: ExtensionEditorComponent | undefined = undefined;
	protected extensionTerminalInputUnsubscribers = new Set<() => void>();

	// Extension widgets (components rendered above/below the editor)
	protected extensionWidgetsAbove = new Map<string, Component & { dispose?(): void }>();
	protected extensionWidgetsBelow = new Map<string, Component & { dispose?(): void }>();
	protected widgetContainerAbove!: Container;
	protected widgetContainerBelow!: Container;

	// Custom footer from extension (undefined = use built-in footer)
	protected customFooter: (Component & { dispose?(): void }) | undefined = undefined;

	// Header container that holds the built-in or custom header
	protected headerContainer: Container;

	// Built-in header (logo + keybinding hints + changelog)
	protected builtInHeader: Component | undefined = undefined;

	// Custom header from extension (undefined = use built-in header)
	protected customHeader: (Component & { dispose?(): void }) | undefined = undefined;

	// Convenience accessors
	protected get session(): AgentSession {
		return this.runtimeHost.session;
	}
	protected get agent() {
		return this.session.agent;
	}
	protected get sessionManager() {
		return this.session.sessionManager;
	}
	protected get settingsManager() {
		return this.session.settingsManager;
	}

	constructor(
		runtimeHost: AgentSessionRuntime,
		protected options: InteractiveModeOptions = {},
	) {
		this.runtimeHost = runtimeHost;
		this.runtimeHost.setBeforeSessionInvalidate(() => {
			this.resetExtensionUI();
		});
		this.runtimeHost.setRebindSession(async () => {
			await this.rebindCurrentSession();
		});
		this.version = VERSION;
		this.ui = new TUI(new ProcessTerminal(), this.settingsManager.getShowHardwareCursor());
		this.ui.setClearOnShrink(this.settingsManager.getClearOnShrink());
		this.headerContainer = new Container();
		this.chatContainer = new Container();
		this.pendingMessagesContainer = new Container();
		this.statusContainer = new Container();
		this.widgetContainerAbove = new Container();
		this.widgetContainerBelow = new Container();
		this.keybindings = KeybindingsManager.create();
		setKeybindings(this.keybindings);
		const editorPaddingX = this.settingsManager.getEditorPaddingX();
		const autocompleteMaxVisible = this.settingsManager.getAutocompleteMaxVisible();
		this.defaultEditor = new CustomEditor(this.ui, getEditorTheme(), this.keybindings, {
			paddingX: editorPaddingX,
			autocompleteMaxVisible,
		});
		this.editor = this.defaultEditor;
		this.editorContainer = new Container();
		this.editorContainer.addChild(this.editor as Component);
		this.footerDataProvider = new FooterDataProvider(this.sessionManager.getCwd());
		this.footer = new FooterComponent(this.session, this.footerDataProvider);
		this.footer.setAutoCompactEnabled(this.session.autoCompactionEnabled);

		// Load hide thinking block setting
		this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();

		// Register themes from resource loader and initialize
		setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
		initTheme(this.settingsManager.getTheme(), true);
	}

	protected getAutocompleteSourceTag(sourceInfo?: SourceInfo): string | undefined {
		return _getAutocompleteSourceTag(sourceInfo);
	}

	protected prefixAutocompleteDescription(
		description: string | undefined,
		sourceInfo?: SourceInfo,
	): string | undefined {
		const sourceTag = this.getAutocompleteSourceTag(sourceInfo);
		if (!sourceTag) {
			return description;
		}
		return description ? `[${sourceTag}] ${description}` : `[${sourceTag}]`;
	}

	protected createBaseAutocompleteProvider(): AutocompleteProvider {
		return _createBaseAutocompleteProvider(this as unknown as InteractiveStartupTarget);
	}

	protected setupAutocompleteProvider(): void {
		_setupAutocompleteProvider(this as unknown as InteractiveStartupTarget);
	}

	protected showStartupNoticesIfNeeded(): void {
		_showStartupNoticesIfNeeded(this as unknown as InteractiveStartupTarget);
	}

	async init(): Promise<void> {
		await _initInteractiveMode(this as unknown as InteractiveStartupTarget);
	}

	/**
	 * Update terminal title with session name and cwd.
	 */
	protected updateTerminalTitle(): void {
		const cwdBasename = path.basename(this.sessionManager.getCwd());
		const sessionName = this.sessionManager.getSessionName();
		if (sessionName) {
			this.ui.terminal.setTitle(`${APP_TITLE} - ${sessionName} - ${cwdBasename}`);
		} else {
			this.ui.terminal.setTitle(`${APP_TITLE} - ${cwdBasename}`);
		}
	}

	/**
	 * Run the interactive mode. This is the main entry point.
	 * Initializes the UI, shows warnings, processes initial messages, and starts the interactive loop.
	 */
	async run(): Promise<void> {
		await this.init();

		// Start version check asynchronously
		this.checkForNewVersion().then((newVersion) => {
			if (newVersion) {
				this.showNewVersionNotification(newVersion);
			}
		});

		// Start package update check asynchronously
		this.checkForPackageUpdates().then((updates) => {
			if (updates.length > 0) {
				this.showPackageUpdateNotification(updates);
			}
		});

		// Check tmux keyboard setup asynchronously
		this.checkTmuxKeyboardSetup().then((warning) => {
			if (warning) {
				this.showWarning(warning);
			}
		});

		// Show startup warnings
		const { migratedProviders, modelFallbackMessage, initialMessage, initialImages, initialMessages } = this.options;

		if (migratedProviders && migratedProviders.length > 0) {
			this.showWarning(`Migrated credentials to auth.json: ${migratedProviders.join(", ")}`);
		}

		const modelsJsonError = this.session.modelRegistry.getError();
		if (modelsJsonError) {
			this.showError(`models.json error: ${modelsJsonError}`);
		}

		if (modelFallbackMessage) {
			this.showWarning(modelFallbackMessage);
		}

		void this.maybeWarnAboutAnthropicSubscriptionAuth();

		// Process initial messages
		if (initialMessage) {
			try {
				await this.session.prompt(initialMessage, { images: initialImages });
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
				this.showError(errorMessage);
			}
		}

		if (initialMessages) {
			for (const message of initialMessages) {
				try {
					await this.session.prompt(message);
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
					this.showError(errorMessage);
				}
			}
		}

		// Main interactive loop
		while (true) {
			const userInput = await this.getUserInput();
			try {
				await this.session.prompt(userInput);
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
				this.showError(errorMessage);
			}
		}
	}

	/**
	 * Check npm registry for a newer version.
	 */
	protected async checkForNewVersion(): Promise<string | undefined> {
		return _checkForNewVersion(this.version);
	}

	protected async checkForPackageUpdates(): Promise<string[]> {
		return _checkForPackageUpdates(this.sessionManager.getCwd(), getAgentDir(), this.settingsManager);
	}

	protected async checkTmuxKeyboardSetup(): Promise<string | undefined> {
		return _checkTmuxKeyboardSetup();
	}

	/**
	 * Get changelog entries to display on startup.
	 * Only shows new entries since last seen version, skips for resumed sessions.
	 */
	protected getChangelogForDisplay(): string | undefined {
		return _getChangelogForDisplay(
			VERSION,
			this.session.state.messages.length > 0,
			() => this.settingsManager.getLastChangelogVersion(),
			(v) => this.settingsManager.setLastChangelogVersion(v),
			(v) => this.reportInstallTelemetry(v),
		);
	}

	protected reportInstallTelemetry(version: string): void {
		_reportInstallTelemetry(version, isInstallTelemetryEnabled(this.settingsManager));
	}

	protected getMarkdownThemeWithSettings(): MarkdownTheme {
		return {
			...getMarkdownTheme(),
			codeBlockIndent: this.settingsManager.getCodeBlockIndent(),
		};
	}

	// =========================================================================
	// Extension System
	// =========================================================================

	protected showLoadedResources(options?: ShowLoadedResourcesOptions): void {
		_showLoadedResources(this as unknown as LoadedResourcesHost, options);
	}

	/**
	 * Initialize the extension system with TUI-based UI context.
	 */
	protected async bindCurrentSessionExtensions(): Promise<void> {
		await _bindCurrentSessionExtensions(this as unknown as SessionRuntimeTarget);
	}

	protected applyRuntimeSettings(): void {
		_applyRuntimeSettings(this as unknown as SessionRuntimeTarget);
	}

	protected async rebindCurrentSession(): Promise<void> {
		await _rebindCurrentSession(this as unknown as SessionRuntimeTarget);
	}

	protected async handleFatalRuntimeError(prefix: string, error: unknown): Promise<never> {
		return _handleFatalRuntimeError(this as unknown as SessionRuntimeTarget, prefix, error);
	}

	protected renderCurrentSessionState(): void {
		_renderCurrentSessionState(this as unknown as SessionRuntimeTarget);
	}

	/**
	 * Get a registered tool definition by name (for custom rendering).
	 */
	protected getRegisteredToolDefinition(toolName: string) {
		return this.session.getToolDefinition(toolName);
	}

	/**
	 * Set up keyboard shortcuts registered by extensions.
	 */
	protected setupExtensionShortcuts(extensionRunner: ExtensionRunner): void {
		_setupExtensionShortcuts(this as unknown as SessionRuntimeTarget, extensionRunner);
	}

	protected createWorkingLoader(): Loader {
		return _createWorkingLoader(this as unknown as ExtensionUiTarget);
	}

	protected stopWorkingLoader(): void {
		_stopWorkingLoader(this as unknown as ExtensionUiTarget);
	}

	protected resetExtensionUI(): void {
		_resetExtensionUI(this as unknown as ExtensionUiTarget);
	}

	protected renderWidgets(): void {
		_renderWidgets(this as unknown as ExtensionUiTarget);
	}

	protected addExtensionTerminalInputListener(
		handler: (data: string) => { consume?: boolean; data?: string } | undefined,
	): () => void {
		return _addExtensionTerminalInputListener(this as unknown as ExtensionUiTarget, handler);
	}

	protected clearExtensionTerminalInputListeners(): void {
		_clearExtensionTerminalInputListeners(this as unknown as ExtensionUiTarget);
	}

	protected createExtensionUIContext(): ExtensionUIContext {
		return _createExtensionUIContext(this as unknown as ExtensionUiTarget);
	}

	protected showExtensionSelector(
		title: string,
		options: string[],
		opts?: ExtensionUIDialogOptions,
	): Promise<string | undefined> {
		return _showExtensionSelector(this as unknown as ExtensionUiTarget, title, options, opts);
	}

	protected hideExtensionSelector(): void {
		_hideExtensionSelector(this as unknown as ExtensionUiTarget);
	}

	protected showExtensionConfirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean> {
		return _showExtensionConfirm(this as unknown as ExtensionUiTarget, title, message, opts);
	}

	protected async promptForMissingSessionCwd(error: MissingSessionCwdError): Promise<string | undefined> {
		return _promptForMissingSessionCwd(this as unknown as SessionRuntimeTarget, error);
	}

	protected showExtensionInput(
		title: string,
		placeholder?: string,
		opts?: ExtensionUIDialogOptions,
	): Promise<string | undefined> {
		return _showExtensionInput(this as unknown as ExtensionUiTarget, title, placeholder, opts);
	}

	protected hideExtensionInput(): void {
		_hideExtensionInput(this as unknown as ExtensionUiTarget);
	}

	protected showExtensionEditor(title: string, prefill?: string): Promise<string | undefined> {
		return _showExtensionEditor(this as unknown as ExtensionUiTarget, title, prefill);
	}

	protected hideExtensionEditor(): void {
		_hideExtensionEditor(this as unknown as ExtensionUiTarget);
	}

	protected setCustomEditorComponent(
		factory: ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent) | undefined,
	): void {
		_setCustomEditorComponent(this as unknown as ExtensionUiTarget, factory);
	}

	protected showExtensionNotify(message: string, type?: "info" | "warning" | "error"): void {
		_showExtensionNotify(this as unknown as ExtensionUiTarget, message, type);
	}

	protected showExtensionCustom<T>(
		factory: (
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (result: T) => void,
		) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
		options?: {
			overlay?: boolean;
			overlayOptions?: OverlayOptions | (() => OverlayOptions);
			onHandle?: (handle: OverlayHandle) => void;
		},
	): Promise<T> {
		return _showExtensionCustom(this as unknown as ExtensionUiTarget, factory, options);
	}

	protected showExtensionError(extensionPath: string, error: string, stack?: string): void {
		_showExtensionError(this as unknown as ExtensionUiTarget, extensionPath, error, stack);
	}

	// =========================================================================
	// Key Handlers
	// =========================================================================

	protected setupKeyHandlers(): void {
		_setupKeyHandlers(this as unknown as KeyHandlerTarget);
	}

	protected setupEditorSubmitHandler(): void {
		const submitTarget = this as unknown as InteractiveSubmitTarget;
		this.defaultEditor.onSubmit = async (text: string) => {
			await _handleEditorSubmit(submitTarget, text);
		};
	}

	protected subscribeToAgent(): void {
		this.unsubscribe = this.session.subscribe(async (event) => {
			await this.handleEvent(event);
		});
	}

	protected async handleEvent(event: AgentSessionEvent): Promise<void> {
		await _handleInteractiveEvent(this as unknown as InteractiveEventTarget, event);
	}

	protected showStatus(message: string): void {
		_showStatus(this as unknown as SessionViewTarget, message);
	}

	protected addMessageToChat(message: AgentMessage, options?: { populateHistory?: boolean }): void {
		_addMessageToChat(this as unknown as SessionViewTarget, message, options);
	}

	protected renderSessionContext(
		sessionContext: SessionContext,
		options: { updateFooter?: boolean; populateHistory?: boolean } = {},
	): void {
		_renderSessionContext(this as unknown as SessionViewTarget, sessionContext, options);
	}

	renderInitialMessages(): void {
		_renderInitialMessages(this as unknown as SessionViewTarget);
	}

	protected rebuildChatFromMessages(): void {
		_rebuildChatFromMessages(this as unknown as SessionViewTarget);
	}

	async getUserInput(): Promise<string> {
		return new Promise((resolve) => {
			this.onInputCallback = (text: string) => {
				this.onInputCallback = undefined;
				resolve(text);
			};
		});
	}

	// =========================================================================
	// Key handlers
	// =========================================================================

	protected handleCtrlC(): void {
		_handleCtrlC(this as unknown as SessionControlTarget);
	}
	protected handleCtrlD(): void {
		_handleCtrlD(this as unknown as SessionControlTarget);
	}
	protected isShuttingDown = false;
	protected async shutdown(): Promise<void> {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;
		await _shutdown(this as unknown as SessionControlTarget);
	}
	protected async checkShutdownRequested(): Promise<void> {
		await _checkShutdownRequested(this as unknown as SessionControlTarget, this.shutdownRequested);
	}
	protected registerSignalHandlers(): void {
		_registerSignalHandlers(this as unknown as SessionControlTarget);
	}
	protected unregisterSignalHandlers(): void {
		_unregisterSignalHandlers(this as unknown as SessionControlTarget);
	}
	protected handleCtrlZ(): void {
		_handleCtrlZ(this as unknown as SessionControlTarget);
	}
	protected async handleFollowUp(): Promise<void> {
		await _handleFollowUp(this as unknown as SessionControlTarget);
	}
	protected handleDequeue(): void {
		_handleDequeue(this as unknown as SessionControlTarget);
	}
	protected updateEditorBorderColor(): void {
		_updateEditorBorderColor(this as unknown as SessionControlTarget);
	}
	protected cycleThinkingLevel(): void {
		_cycleThinkingLevel(this as unknown as SessionControlTarget);
	}
	protected async cycleModel(direction: "forward" | "backward"): Promise<void> {
		await _cycleModel(this as unknown as SessionControlTarget, direction, (model) => {
			void this.maybeWarnAboutAnthropicSubscriptionAuth(model);
		});
	}
	protected toggleToolOutputExpansion(): void {
		this.setToolsExpanded(!this.toolOutputExpanded);
	}
	protected setToolsExpanded(expanded: boolean): void {
		_setToolsExpanded(this as unknown as SessionControlTarget, expanded);
	}
	protected toggleThinkingBlockVisibility(): void {
		_toggleThinkingBlockVisibility(this as unknown as SessionControlTarget);
	}
	protected openExternalEditor(): void {
		_openExternalEditor(this as unknown as SessionControlTarget);
	}

	clearEditor(): void {
		this.editor.setText("");
		this.ui.requestRender();
	}

	showError(errorMessage: string): void {
		_showInteractiveError(this as unknown as SessionFeedbackTarget, errorMessage);
	}

	showWarning(warningMessage: string): void {
		_showInteractiveWarning(this as unknown as SessionFeedbackTarget, warningMessage);
	}

	showNewVersionNotification(newVersion: string): void {
		_showNewVersionNotification(this as unknown as SessionFeedbackTarget, newVersion);
	}

	showPackageUpdateNotification(packages: string[]): void {
		_showPackageUpdateNotification(this as unknown as SessionFeedbackTarget, packages);
	}

	protected getAllQueuedMessages(): { steering: string[]; followUp: string[] } {
		return _readAllQueuedMessages(this as unknown as SessionFeedbackTarget);
	}

	protected clearAllQueues(): { steering: string[]; followUp: string[] } {
		return _clearQueuedMessages(this as unknown as SessionFeedbackTarget);
	}

	protected updatePendingMessagesDisplay(): void {
		_updatePendingMessagesDisplay(this as unknown as SessionFeedbackTarget);
	}

	protected restoreQueuedMessagesToEditor(options?: { abort?: boolean; currentText?: string }): number {
		return _restoreQueuedMessagesToEditor(this as unknown as SessionFeedbackTarget, options);
	}

	protected queueCompactionMessage(text: string, mode: "steer" | "followUp"): void {
		_queueCompactionMessage(this as unknown as SessionFeedbackTarget, text, mode);
	}

	protected isExtensionCommand(text: string): boolean {
		return _isExtensionCommandText(text, this.session.extensionRunner);
	}

	protected async flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void> {
		return _flushCompactionQueuedMessages(
			{
				session: this.session,
				extensionRunner: this.session.extensionRunner,
				getCompactionQueuedMessages: () => this.compactionQueuedMessages,
				setCompactionQueuedMessages: (messages) => {
					this.compactionQueuedMessages = messages;
				},
				updatePendingMessagesDisplay: () => this.updatePendingMessagesDisplay(),
				showError: (message) => this.showError(message),
			},
			options,
		);
	}

	protected flushPendingBashComponents(): void {
		_flushPendingBashComponents(this as unknown as SessionFeedbackTarget);
	}
	protected showSelector(create: (done: () => void) => { component: Component; focus: Component }): void {
		const done = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.ui.setFocus(this.editor);
		};
		const { component, focus } = create(done);
		this.editorContainer.clear();
		this.editorContainer.addChild(component);
		this.ui.setFocus(focus);
		this.ui.requestRender();
	}

	protected showSettingsSelector(): void {
		_showSettingsSelector(this as unknown as SettingsSelectorTarget);
	}

	protected async handleModelCommand(searchTerm?: string): Promise<void> {
		await _handleModelCommand(this as unknown as ModelAuthActionsTarget, searchTerm);
	}

	protected async findExactModelMatch(searchTerm: string): Promise<Model<Api> | undefined> {
		return _findExactModelMatch(this as unknown as ModelAuthActionsTarget, searchTerm);
	}

	protected async getModelCandidates(): Promise<Model<Api>[]> {
		return _getModelCandidates(this as unknown as ModelAuthActionsTarget);
	}

	protected async updateAvailableProviderCount(): Promise<void> {
		await _updateAvailableProviderCount(this as unknown as ModelAuthActionsTarget);
	}

	protected async maybeWarnAboutAnthropicSubscriptionAuth(model?: Model<Api>): Promise<void> {
		await _maybeWarnAboutAnthropicSubscriptionAuth(this as unknown as ModelAuthActionsTarget, model);
	}

	protected showModelSelector(initialSearchInput?: string): void {
		_showModelSelector(this as unknown as ModelSelectorTarget, initialSearchInput);
	}

	protected async handleSkillsCommand(searchTerm?: string): Promise<void> {
		await _handleSkillsCommand(this as unknown as SkillSelectorTarget, searchTerm);
	}

	protected async showModelsSelector(): Promise<void> {
		await _showModelsSelector(this as unknown as ModelSelectorTarget);
	}

	protected showUserMessageSelector(): void {
		_showUserMessageSelector(this as unknown as NavigationSelectorTarget);
	}

	protected async handleCloneCommand(): Promise<void> {
		await _handleCloneCommand(this as unknown as SessionRuntimeTarget);
	}

	protected showTreeSelector(initialSelectedId?: string): void {
		_showTreeSelector(this as unknown as NavigationSelectorTarget, initialSelectedId);
	}

	protected showSessionSelector(): void {
		_showSessionSelector(this as unknown as SessionSelectorTarget);
	}

	protected async handleResumeSession(
		sessionPath: string,
		options?: Parameters<ExtensionCommandContext["switchSession"]>[1],
	): Promise<{ cancelled: boolean }> {
		return _handleResumeSession(this as unknown as SessionRuntimeTarget, sessionPath, options);
	}

	protected async showOAuthSelector(mode: "login" | "logout"): Promise<void> {
		await _showOAuthSelector(this as unknown as AuthSelectorTarget, mode);
	}
	protected showBedrockSetupDialog(providerId: string, providerName: string): void {
		_showBedrockSetupDialog(this as unknown as AuthDialogTarget, providerId, providerName);
	}
	protected async showApiKeyLoginDialog(providerId: string, providerName: string): Promise<void> {
		await _showApiKeyLoginDialog(this as unknown as AuthDialogTarget, providerId, providerName);
	}
	protected async showLoginDialog(providerId: string, providerName: string): Promise<void> {
		await _showLoginDialog(this as unknown as AuthDialogTarget, providerId, providerName);
	}
	protected async handleReloadCommand(): Promise<void> {
		await _handleReloadCommand(this as unknown as ReloadCommandTarget);
	}
	protected async handleExportCommand(text: string): Promise<void> {
		await _handleExportCommand(this as unknown as SessionCommandTarget, text);
	}
	protected async handleImportCommand(text: string): Promise<void> {
		await _handleImportCommand(this as unknown as SessionCommandTarget, text);
	}
	protected async handleShareCommand(): Promise<void> {
		await _handleShareCommand(this as unknown as InteractiveShareCommandTarget);
	}
	protected async handleCopyCommand(): Promise<void> {
		await _handleCopyCommand(this as unknown as SessionCommandTarget);
	}
	protected handleNameCommand(text: string): void {
		_handleNameCommand(this as unknown as SessionCommandTarget, text);
	}
	protected handleSessionCommand(): void {
		_handleSessionCommand(this as unknown as SessionCommandTarget);
	}
	protected handleChangelogCommand(): void {
		_handleChangelogCommand(this as unknown as SessionCommandTarget);
	}
	protected capitalizeKey(key: string): string {
		return key
			.split("/")
			.map((k) =>
				k
					.split("+")
					.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
					.join("+"),
			)
			.join("/");
	}
	protected getAppKeyDisplay(action: AppKeybinding): string {
		return this.capitalizeKey(keyText(action));
	}
	protected getEditorKeyDisplay(action: Keybinding): string {
		return this.capitalizeKey(keyText(action));
	}
	protected handleHotkeysCommand(): void {
		_handleHotkeysCommand(this as unknown as LowerCommandActionsTarget, process.platform);
	}
	protected handleArminSaysHi(): void {
		_handleArminSaysHi(this as unknown as LowerCommandActionsTarget);
	}
	protected handleDementedDelves(): void {
		_handleDementedDelves(this as unknown as LowerCommandActionsTarget);
	}
	protected handleDaxnuts(): void {
		_handleDaxnuts(this as unknown as LowerCommandActionsTarget);
	}
	protected checkDaxnutsEasterEgg(model: { provider: string; id: string }): void {
		_checkDaxnutsEasterEgg(this as unknown as LowerCommandActionsTarget, model);
	}
	protected async handleClearCommand(): Promise<void> {
		await _handleClearCommand(this as unknown as SessionCommandTarget);
	}

	protected handleDebugCommand(): void {
		_handleDebugCommand(this as unknown as SessionCommandTarget);
	}

	protected async handleBashCommand(command: string, excludeFromContext = false): Promise<void> {
		await _handleBashCommand(this as unknown as InteractiveBashCommandTarget, command, excludeFromContext);
	}
	protected async handleCompactCommand(customInstructions?: string): Promise<void> {
		await _handleCompactCommand(this as unknown as SessionCommandTarget, customInstructions);
	}
	stop(): void {
		this.unregisterSignalHandlers();
		if (this.settingsManager.getShowTerminalProgress()) this.ui.terminal.setProgress(false);
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = undefined;
		}
		this.clearExtensionTerminalInputListeners();
		this.footer.dispose();
		this.footerDataProvider.dispose();
		this.unsubscribe?.();
		if (this.isInitialized) {
			this.ui.stop();
			this.isInitialized = false;
		}
	}
}
