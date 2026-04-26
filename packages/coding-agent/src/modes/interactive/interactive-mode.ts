import * as path from "node:path";
/**
 * Interactive mode for the coding agent.
 * Handles TUI rendering and user interaction, delegating business logic to AgentSession.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Api, AssistantMessage, ImageContent, Model } from "@mariozechner/pi-ai";
import type {
	AutocompleteItem,
	AutocompleteProvider,
	EditorComponent,
	EditorTheme,
	Keybinding,
	KeyId,
	MarkdownTheme,
	OverlayHandle,
	OverlayOptions,
	SlashCommand,
} from "@mariozechner/pi-tui";
import {
	CombinedAutocompleteProvider,
	type Component,
	Container,
	fuzzyFilter,
	type Loader,
	type LoaderIndicatorOptions,
	Markdown,
	matchesKey,
	ProcessTerminal,
	Spacer,
	setKeybindings,
	Text,
	TruncatedText,
	TUI,
} from "@mariozechner/pi-tui";
import { APP_NAME, APP_TITLE, getAgentDir, VERSION } from "../../config.js";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session.js";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.js";
import type {
	AutocompleteProviderFactory,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionRunner,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
} from "../../core/extensions/index.js";
import { FooterDataProvider } from "../../core/footer-data-provider.js";
import { type AppKeybinding, KeybindingsManager } from "../../core/keybindings.js";
import { formatMissingSessionCwdPrompt, MissingSessionCwdError } from "../../core/session-cwd.js";
import type { SessionContext } from "../../core/session-manager.js";
import { BUILTIN_SLASH_COMMANDS } from "../../core/slash-commands.js";
import type { SourceInfo } from "../../core/source-info.js";
import { isInstallTelemetryEnabled } from "../../core/telemetry.js";
import { ensureTool } from "../../utils/tools-manager.js";
import type { AssistantMessageComponent } from "./components/assistant-message.js";
import type { BashExecutionComponent } from "./components/bash-execution.js";
import type { CountdownTimer } from "./components/countdown-timer.js";
import { CustomEditor } from "./components/custom-editor.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import { ExpandableText } from "./components/expandable-text.js";
import type { ExtensionEditorComponent } from "./components/extension-editor.js";
import type { ExtensionInputComponent } from "./components/extension-input.js";
import type { ExtensionSelectorComponent } from "./components/extension-selector.js";
import { FooterComponent } from "./components/footer.js";
import { keyHint, keyText, rawKeyHint } from "./components/keybinding-hints.js";
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
	clearAllQueuedMessages as _clearAllQueuedMessages,
	flushCompactionQueuedMessages as _flushCompactionQueuedMessages,
	getAllQueuedMessages as _getAllQueuedMessages,
	isExtensionCommandText as _isExtensionCommandText,
	type CompactionQueuedMessage,
} from "./internal/session-queue.js";
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
import {
	getEditorTheme,
	getMarkdownTheme,
	initTheme,
	onThemeChange,
	setRegisteredThemes,
	stopThemeWatcher,
	type Theme,
	theme,
} from "./theme/theme.js";

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
	private runtimeHost: AgentSessionRuntime;
	private ui: TUI;
	private chatContainer: Container;
	private pendingMessagesContainer: Container;
	private statusContainer: Container;
	private defaultEditor: CustomEditor;
	private editor: EditorComponent;
	private autocompleteProvider: AutocompleteProvider | undefined;
	private autocompleteProviderWrappers: AutocompleteProviderFactory[] = [];
	private fdPath: string | undefined;
	private editorContainer: Container;
	private footer: FooterComponent;
	private footerDataProvider: FooterDataProvider;
	// Stored so the same manager can be injected into custom editors, selectors, and extension UI.
	private keybindings: KeybindingsManager;
	private version: string;
	private isInitialized = false;
	private onInputCallback?: (text: string) => void;
	private loadingAnimation: Loader | undefined = undefined;
	private workingMessage: string | undefined = undefined;
	private workingVisible = true;
	private workingIndicatorOptions: LoaderIndicatorOptions | undefined = undefined;
	private readonly defaultWorkingMessage = "Working...";
	private readonly defaultHiddenThinkingLabel = "Thinking...";
	private hiddenThinkingLabel = this.defaultHiddenThinkingLabel;

	private lastSigintTime = 0;
	private lastEscapeTime = 0;
	private changelogMarkdown: string | undefined = undefined;
	private startupNoticesShown = false;
	private anthropicSubscriptionWarningShown = false;

	// Status line tracking (for mutating immediately-sequential status updates)
	private lastStatusSpacer: Spacer | undefined = undefined;
	private lastStatusText: Text | undefined = undefined;

	// Streaming message tracking
	private streamingComponent: AssistantMessageComponent | undefined = undefined;
	private streamingMessage: AssistantMessage | undefined = undefined;

	// Tool execution tracking: toolCallId -> component
	private pendingTools = new Map<string, ToolExecutionComponent>();

	// Tool output expansion state
	private toolOutputExpanded = false;

	// Thinking block visibility state
	private hideThinkingBlock = false;

	// Skill commands: command name -> skill file path
	private skillCommands = new Map<string, string>();

	// Agent subscription unsubscribe function
	private unsubscribe?: () => void;
	private signalCleanupHandlers: Array<() => void> = [];

	// Track if editor is in bash mode (text starts with !)
	private isBashMode = false;

	// Track current bash execution component
	private bashComponent: BashExecutionComponent | undefined = undefined;

	// Track pending bash components (shown in pending area, moved to chat on submit)
	private pendingBashComponents: BashExecutionComponent[] = [];

	// Auto-compaction state
	private autoCompactionLoader: Loader | undefined = undefined;
	private autoCompactionEscapeHandler?: () => void;

	// Auto-retry state
	private retryLoader: Loader | undefined = undefined;
	private retryCountdown: CountdownTimer | undefined = undefined;
	private retryEscapeHandler?: () => void;

	// Messages queued while compaction is running
	private compactionQueuedMessages: CompactionQueuedMessage[] = [];

	// Shutdown state
	private shutdownRequested = false;

	// Extension UI state
	private extensionSelector: ExtensionSelectorComponent | undefined = undefined;
	private extensionInput: ExtensionInputComponent | undefined = undefined;
	private extensionEditor: ExtensionEditorComponent | undefined = undefined;
	private extensionTerminalInputUnsubscribers = new Set<() => void>();

	// Extension widgets (components rendered above/below the editor)
	private extensionWidgetsAbove = new Map<string, Component & { dispose?(): void }>();
	private extensionWidgetsBelow = new Map<string, Component & { dispose?(): void }>();
	private widgetContainerAbove!: Container;
	private widgetContainerBelow!: Container;

	// Custom footer from extension (undefined = use built-in footer)
	private customFooter: (Component & { dispose?(): void }) | undefined = undefined;

	// Header container that holds the built-in or custom header
	private headerContainer: Container;

	// Built-in header (logo + keybinding hints + changelog)
	private builtInHeader: Component | undefined = undefined;

	// Custom header from extension (undefined = use built-in header)
	private customHeader: (Component & { dispose?(): void }) | undefined = undefined;

	// Convenience accessors
	private get session(): AgentSession {
		return this.runtimeHost.session;
	}
	private get agent() {
		return this.session.agent;
	}
	private get sessionManager() {
		return this.session.sessionManager;
	}
	private get settingsManager() {
		return this.session.settingsManager;
	}

	constructor(
		runtimeHost: AgentSessionRuntime,
		private options: InteractiveModeOptions = {},
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
		this.bindControllerReferences();

		// Load hide thinking block setting
		this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();

		// Register themes from resource loader and initialize
		setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
		initTheme(this.settingsManager.getTheme(), true);
	}

	private bindControllerReferences(): void {
		void this.autocompleteProvider;
		void this.autocompleteProviderWrappers;
		void this.onInputCallback;
		void this.workingMessage;
		void this.workingVisible;
		void this.workingIndicatorOptions;
		void this.defaultWorkingMessage;
		void this.hiddenThinkingLabel;
		void this.lastEscapeTime;
		void this.anthropicSubscriptionWarningShown;
		void this.lastStatusSpacer;
		void this.lastStatusText;
		void this.bashComponent;
		void this.autoCompactionLoader;
		void this.autoCompactionEscapeHandler;
		void this.retryLoader;
		void this.retryCountdown;
		void this.retryEscapeHandler;
		void this.extensionSelector;
		void this.extensionInput;
		void this.extensionEditor;
		void this.extensionTerminalInputUnsubscribers;
		void this.extensionWidgetsAbove;
		void this.extensionWidgetsBelow;
		void this.widgetContainerAbove;
		void this.widgetContainerBelow;
		void this.customFooter;
		void this.customHeader;
		void this.handleClearCommand;
		void this.handleDebugCommand;
		void this.showTreeSelector;
		void this.showSessionSelector;
		void this.showOAuthSelector;
		void this.showBedrockSetupDialog;
		void this.showApiKeyLoginDialog;
		void this.showLoginDialog;
		void this.handleExportCommand;
		void this.handleImportCommand;
		void this.handleShareCommand;
		void this.handleCopyCommand;
		void this.handleNameCommand;
		void this.handleSessionCommand;
		void this.handleChangelogCommand;
		void this.getEditorKeyDisplay;
		void this.handleHotkeysCommand;
		void this.handleArminSaysHi;
		void this.handleDementedDelves;
		void this.handleDaxnuts;
		void this.checkDaxnutsEasterEgg;
		void this.handleBashCommand;
		void this.handleCompactCommand;
		void this.getRegisteredToolDefinition;
		void this.createWorkingLoader;
		void this.stopWorkingLoader;
		void this.addExtensionTerminalInputListener;
		void this.showExtensionSelector;
		void this.hideExtensionSelector;
		void this.showExtensionInput;
		void this.hideExtensionInput;
		void this.showExtensionEditor;
		void this.hideExtensionEditor;
		void this.setCustomEditorComponent;
		void this.showExtensionNotify;
		void this.showExtensionCustom;
		void this.addMessageToChat;
		void this.renderSessionContext;
		void this.handleCtrlC;
		void this.handleCtrlD;
		void this.checkShutdownRequested;
		void this.handleCtrlZ;
		void this.handleFollowUp;
		void this.handleDequeue;
		void this.updateEditorBorderColor;
		void this.cycleThinkingLevel;
		void this.cycleModel;
		void this.toggleToolOutputExpansion;
		void this.toggleThinkingBlockVisibility;
		void this.openExternalEditor;
		void this.restoreQueuedMessagesToEditor;
		void this.queueCompactionMessage;
		void this.lastSigintTime;
		void this.streamingComponent;
		void this.streamingMessage;
		void this.hideThinkingBlock;
		void this.signalCleanupHandlers;
		void this.isBashMode;
		void this.rebuildChatFromMessages;
		void this.isExtensionCommand;
		void this.flushPendingBashComponents;
		void this.showSelector;
		void this.showSettingsSelector;
		void this.handleModelCommand;
		void this.findExactModelMatch;
		void this.getModelCandidates;
		void this.showModelSelector;
		void this.handleSkillsCommand;
		void this.showModelsSelector;
		void this.showUserMessageSelector;
		void this.handleCloneCommand;
	}

	private getAutocompleteSourceTag(sourceInfo?: SourceInfo): string | undefined {
		return _getAutocompleteSourceTag(sourceInfo);
	}

	private prefixAutocompleteDescription(description: string | undefined, sourceInfo?: SourceInfo): string | undefined {
		const sourceTag = this.getAutocompleteSourceTag(sourceInfo);
		if (!sourceTag) {
			return description;
		}
		return description ? `[${sourceTag}] ${description}` : `[${sourceTag}]`;
	}

	private createBaseAutocompleteProvider(): AutocompleteProvider {
		// Define commands for autocomplete
		const slashCommands: SlashCommand[] = BUILTIN_SLASH_COMMANDS.map((command) => ({
			name: command.name,
			description: command.description,
		}));

		const modelCommand = slashCommands.find((command) => command.name === "model");
		if (modelCommand) {
			modelCommand.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null => {
				// Get available models (scoped or from registry)
				const models =
					this.session.scopedModels.length > 0
						? this.session.scopedModels.map((s) => s.model)
						: this.session.modelRegistry.getAvailable();

				if (models.length === 0) return null;

				// Create items with provider/id format
				const items = models.map((m) => ({
					id: m.id,
					provider: m.provider,
					label: `${m.provider}/${m.id}`,
				}));

				// Fuzzy filter by model ID + provider (allows "opus anthropic" to match)
				const filtered = fuzzyFilter(items, prefix, (item) => `${item.id} ${item.provider}`);

				if (filtered.length === 0) return null;

				return filtered.map((item) => ({
					value: item.label,
					label: item.id,
					description: item.provider,
				}));
			};
		}

		// Convert prompt templates to SlashCommand format for autocomplete
		const templateCommands: SlashCommand[] = this.session.promptTemplates.map((cmd) => ({
			name: cmd.name,
			description: this.prefixAutocompleteDescription(cmd.description, cmd.sourceInfo),
			...(cmd.argumentHint && { argumentHint: cmd.argumentHint }),
		}));

		// Convert extension commands to SlashCommand format
		const builtinCommandNames = new Set(slashCommands.map((c) => c.name));
		const extensionCommands: SlashCommand[] = this.session.extensionRunner
			.getRegisteredCommands()
			.filter((cmd) => !builtinCommandNames.has(cmd.name))
			.map((cmd) => ({
				name: cmd.invocationName,
				description: this.prefixAutocompleteDescription(cmd.description, cmd.sourceInfo),
				getArgumentCompletions: cmd.getArgumentCompletions,
			}));

		// Build skill commands from session.skills (if enabled)
		this.skillCommands.clear();
		const skillCommandList: SlashCommand[] = [];
		if (this.settingsManager.getEnableSkillCommands()) {
			for (const skill of this.session.resourceLoader.getSkills().skills) {
				const commandName = `skill:${skill.name}`;
				this.skillCommands.set(commandName, skill.filePath);
				skillCommandList.push({
					name: commandName,
					description: this.prefixAutocompleteDescription(skill.description, skill.sourceInfo),
				});
			}
		}

		return new CombinedAutocompleteProvider(
			[...slashCommands, ...templateCommands, ...extensionCommands, ...skillCommandList],
			this.sessionManager.getCwd(),
			this.fdPath,
		);
	}

	private setupAutocompleteProvider(): void {
		let provider = this.createBaseAutocompleteProvider();
		for (const wrapProvider of this.autocompleteProviderWrappers) {
			provider = wrapProvider(provider);
		}

		this.autocompleteProvider = provider;
		this.defaultEditor.setAutocompleteProvider(provider);
		if (this.editor !== this.defaultEditor) {
			this.editor.setAutocompleteProvider?.(provider);
		}
	}

	private showStartupNoticesIfNeeded(): void {
		if (this.startupNoticesShown) {
			return;
		}
		this.startupNoticesShown = true;

		if (!this.changelogMarkdown) {
			return;
		}

		if (this.chatContainer.children.length > 0) {
			this.chatContainer.addChild(new Spacer(1));
		}
		this.chatContainer.addChild(new DynamicBorder());
		if (this.settingsManager.getCollapseChangelog()) {
			const versionMatch = this.changelogMarkdown.match(/##\s+\[?(\d+\.\d+\.\d+)\]?/);
			const latestVersion = versionMatch ? versionMatch[1] : this.version;
			const condensedText = `Updated to v${latestVersion}. Use ${theme.bold("/changelog")} to view full changelog.`;
			this.chatContainer.addChild(new Text(condensedText, 1, 0));
		} else {
			this.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(
				new Markdown(this.changelogMarkdown.trim(), 1, 0, this.getMarkdownThemeWithSettings()),
			);
			this.chatContainer.addChild(new Spacer(1));
		}
		this.chatContainer.addChild(new DynamicBorder());
	}

	async init(): Promise<void> {
		if (this.isInitialized) return;

		this.registerSignalHandlers();

		// Load changelog (only show new entries, skip for resumed sessions)
		this.changelogMarkdown = this.getChangelogForDisplay();

		// Ensure fd and rg are available (downloads if missing, adds to PATH via getBinDir)
		// Both are needed: fd for autocomplete, rg for grep tool and bash commands
		const [fdPath] = await Promise.all([ensureTool("fd"), ensureTool("rg")]);
		this.fdPath = fdPath;

		// Add header container as first child
		this.ui.addChild(this.headerContainer);

		// Add header with keybindings from config (unless silenced)
		if (this.options.verbose || !this.settingsManager.getQuietStartup()) {
			const logo = theme.bold(theme.fg("accent", APP_NAME)) + theme.fg("dim", ` v${this.version}`);

			// Build startup instructions using keybinding hint helpers
			const hint = (keybinding: AppKeybinding, description: string) => keyHint(keybinding, description);

			const expandedInstructions = [
				hint("app.interrupt", "to interrupt"),
				hint("app.clear", "to clear"),
				rawKeyHint(`${keyText("app.clear")} twice`, "to exit"),
				hint("app.exit", "to exit (empty)"),
				hint("app.suspend", "to suspend"),
				keyHint("tui.editor.deleteToLineEnd", "to delete to end"),
				hint("app.thinking.cycle", "to cycle thinking level"),
				rawKeyHint(`${keyText("app.model.cycleForward")}/${keyText("app.model.cycleBackward")}`, "to cycle models"),
				hint("app.model.select", "to select model"),
				hint("app.tools.expand", "to expand tools"),
				hint("app.thinking.toggle", "to expand thinking"),
				hint("app.editor.external", "for external editor"),
				rawKeyHint("/", "for commands"),
				rawKeyHint("!", "to run bash"),
				rawKeyHint("!!", "to run bash (no context)"),
				hint("app.message.followUp", "to queue follow-up"),
				hint("app.message.dequeue", "to edit all queued messages"),
				hint("app.clipboard.pasteImage", "to paste image"),
				rawKeyHint("drop files", "to attach"),
			].join("\n");
			const compactInstructions = [
				hint("app.interrupt", "interrupt"),
				rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
				rawKeyHint("/", "commands"),
				rawKeyHint("!", "bash"),
				hint("app.tools.expand", "more"),
			].join(theme.fg("muted", " · "));
			const compactOnboarding = theme.fg(
				"dim",
				`Press ${keyText("app.tools.expand")} to show full startup help and loaded resources.`,
			);
			const onboarding = theme.fg(
				"dim",
				`Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.`,
			);
			this.builtInHeader = new ExpandableText(
				() => `${logo}\n${compactInstructions}\n${compactOnboarding}\n\n${onboarding}`,
				() => `${logo}\n${expandedInstructions}\n\n${onboarding}`,
				this.options.verbose === true || this.toolOutputExpanded,
				1,
				0,
			);

			// Setup UI layout
			this.headerContainer.addChild(new Spacer(1));
			this.headerContainer.addChild(this.builtInHeader);
			this.headerContainer.addChild(new Spacer(1));
		} else {
			// Minimal header when silenced
			this.builtInHeader = new Text("", 0, 0);
			this.headerContainer.addChild(this.builtInHeader);
		}

		this.ui.addChild(this.chatContainer);
		this.ui.addChild(this.pendingMessagesContainer);
		this.ui.addChild(this.statusContainer);
		this.renderWidgets(); // Initialize with default spacer
		this.ui.addChild(this.widgetContainerAbove);
		this.ui.addChild(this.editorContainer);
		this.ui.addChild(this.widgetContainerBelow);
		this.ui.addChild(this.footer);
		this.ui.setFocus(this.editor);

		this.setupKeyHandlers();
		this.setupEditorSubmitHandler();

		// Start the UI before initializing extensions so session_start handlers can use interactive dialogs
		this.ui.start();
		this.isInitialized = true;

		// Initialize extensions first so resources are shown before messages
		await this.rebindCurrentSession();

		// Render initial messages AFTER showing loaded resources
		this.renderInitialMessages();

		// Set up theme file watcher
		onThemeChange(() => {
			this.ui.invalidate();
			this.updateEditorBorderColor();
			this.ui.requestRender();
		});

		// Set up git branch watcher (uses provider instead of footer)
		this.footerDataProvider.onBranchChange(() => {
			this.ui.requestRender();
		});

		// Initialize available provider count for footer display
		await this.updateAvailableProviderCount();
	}

	/**
	 * Update terminal title with session name and cwd.
	 */
	private updateTerminalTitle(): void {
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
	private async checkForNewVersion(): Promise<string | undefined> {
		return _checkForNewVersion(this.version);
	}

	private async checkForPackageUpdates(): Promise<string[]> {
		return _checkForPackageUpdates(this.sessionManager.getCwd(), getAgentDir(), this.settingsManager);
	}

	private async checkTmuxKeyboardSetup(): Promise<string | undefined> {
		return _checkTmuxKeyboardSetup();
	}

	/**
	 * Get changelog entries to display on startup.
	 * Only shows new entries since last seen version, skips for resumed sessions.
	 */
	private getChangelogForDisplay(): string | undefined {
		return _getChangelogForDisplay(
			VERSION,
			this.session.state.messages.length > 0,
			() => this.settingsManager.getLastChangelogVersion(),
			(v) => this.settingsManager.setLastChangelogVersion(v),
			(v) => this.reportInstallTelemetry(v),
		);
	}

	private reportInstallTelemetry(version: string): void {
		_reportInstallTelemetry(version, isInstallTelemetryEnabled(this.settingsManager));
	}

	private getMarkdownThemeWithSettings(): MarkdownTheme {
		return {
			...getMarkdownTheme(),
			codeBlockIndent: this.settingsManager.getCodeBlockIndent(),
		};
	}

	// =========================================================================
	// Extension System
	// =========================================================================

	private showLoadedResources(options?: ShowLoadedResourcesOptions): void {
		_showLoadedResources(this as unknown as LoadedResourcesHost, options);
	}

	/**
	 * Initialize the extension system with TUI-based UI context.
	 */
	private async bindCurrentSessionExtensions(): Promise<void> {
		const uiContext = this.createExtensionUIContext();
		await this.session.bindExtensions({
			uiContext,
			commandContextActions: {
				waitForIdle: () => this.session.agent.waitForIdle(),
				newSession: async (options) => {
					if (this.loadingAnimation) {
						this.loadingAnimation.stop();
						this.loadingAnimation = undefined;
					}
					this.statusContainer.clear();
					try {
						const result = await this.runtimeHost.newSession(options);
						if (!result.cancelled) {
							this.renderCurrentSessionState();
							this.ui.requestRender();
						}
						return result;
					} catch (error: unknown) {
						return this.handleFatalRuntimeError("Failed to create session", error);
					}
				},
				fork: async (entryId, options) => {
					try {
						const result = await this.runtimeHost.fork(entryId, options);
						if (!result.cancelled) {
							this.renderCurrentSessionState();
							this.editor.setText(result.selectedText ?? "");
							this.showStatus("Forked to new session");
						}
						return { cancelled: result.cancelled };
					} catch (error: unknown) {
						return this.handleFatalRuntimeError("Failed to fork session", error);
					}
				},
				navigateTree: async (targetId, options) => {
					const result = await this.session.navigateTree(targetId, {
						summarize: options?.summarize,
						customInstructions: options?.customInstructions,
						replaceInstructions: options?.replaceInstructions,
						label: options?.label,
					});
					if (result.cancelled) {
						return { cancelled: true };
					}

					this.chatContainer.clear();
					this.renderInitialMessages();
					if (result.editorText && !this.editor.getText().trim()) {
						this.editor.setText(result.editorText);
					}
					this.showStatus("Navigated to selected point");
					void this.flushCompactionQueue({ willRetry: false });
					return { cancelled: false };
				},
				switchSession: async (sessionPath, options) => {
					return this.handleResumeSession(sessionPath, options);
				},
				reload: async () => {
					await this.handleReloadCommand();
				},
			},
			shutdownHandler: () => {
				this.shutdownRequested = true;
				if (!this.session.isStreaming) {
					void this.shutdown();
				}
			},
			onError: (error) => {
				this.showExtensionError(error.extensionPath, error.error, error.stack);
			},
		});

		setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
		this.setupAutocompleteProvider();

		const extensionRunner = this.session.extensionRunner;
		this.setupExtensionShortcuts(extensionRunner);
		this.showLoadedResources({ force: false, showDiagnosticsWhenQuiet: true });
		this.showStartupNoticesIfNeeded();
	}

	private applyRuntimeSettings(): void {
		this.footer.setSession(this.session);
		this.footer.setAutoCompactEnabled(this.session.autoCompactionEnabled);
		this.footerDataProvider.setCwd(this.sessionManager.getCwd());
		this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
		this.ui.setShowHardwareCursor(this.settingsManager.getShowHardwareCursor());
		this.ui.setClearOnShrink(this.settingsManager.getClearOnShrink());
		const editorPaddingX = this.settingsManager.getEditorPaddingX();
		const autocompleteMaxVisible = this.settingsManager.getAutocompleteMaxVisible();
		this.defaultEditor.setPaddingX(editorPaddingX);
		this.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
		if (this.editor !== this.defaultEditor) {
			this.editor.setPaddingX?.(editorPaddingX);
			this.editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
		}
	}

	private async rebindCurrentSession(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.applyRuntimeSettings();
		await this.bindCurrentSessionExtensions();
		this.subscribeToAgent();
		await this.updateAvailableProviderCount();
		this.updateEditorBorderColor();
		this.updateTerminalTitle();
	}

	private async handleFatalRuntimeError(prefix: string, error: unknown): Promise<never> {
		const message = error instanceof Error ? error.message : String(error);
		this.showError(`${prefix}: ${message}`);
		stopThemeWatcher();
		this.stop();
		process.exit(1);
	}

	private renderCurrentSessionState(): void {
		this.chatContainer.clear();
		this.pendingMessagesContainer.clear();
		this.compactionQueuedMessages = [];
		this.streamingComponent = undefined;
		this.streamingMessage = undefined;
		this.pendingTools.clear();
		this.renderInitialMessages();
	}

	/**
	 * Get a registered tool definition by name (for custom rendering).
	 */
	private getRegisteredToolDefinition(toolName: string) {
		return this.session.getToolDefinition(toolName);
	}

	/**
	 * Set up keyboard shortcuts registered by extensions.
	 */
	private setupExtensionShortcuts(extensionRunner: ExtensionRunner): void {
		const shortcuts = extensionRunner.getShortcuts(this.keybindings.getEffectiveConfig());
		if (shortcuts.size === 0) return;

		// Create a context for shortcut handlers
		const createContext = (): ExtensionContext => ({
			ui: this.createExtensionUIContext(),
			hasUI: true,
			cwd: this.sessionManager.getCwd(),
			sessionManager: this.sessionManager,
			modelRegistry: this.session.modelRegistry,
			model: this.session.model,
			isIdle: () => !this.session.isStreaming,
			signal: this.session.agent.signal,
			abort: () => this.session.abort(),
			hasPendingMessages: () => this.session.pendingMessageCount > 0,
			shutdown: () => {
				this.shutdownRequested = true;
			},
			getContextUsage: () => this.session.getContextUsage(),
			compact: (options) => {
				void (async () => {
					try {
						const result = await this.session.compact(options?.customInstructions);
						options?.onComplete?.(result);
					} catch (error) {
						const err = error instanceof Error ? error : new Error(String(error));
						options?.onError?.(err);
					}
				})();
			},
			getSystemPrompt: () => this.session.systemPrompt,
		});

		// Set up the extension shortcut handler on the default editor
		this.defaultEditor.onExtensionShortcut = (data: string) => {
			for (const [shortcutStr, shortcut] of shortcuts) {
				// Cast to KeyId - extension shortcuts use the same format
				if (matchesKey(data, shortcutStr as KeyId)) {
					// Run handler async, don't block input
					Promise.resolve(shortcut.handler(createContext())).catch((err) => {
						this.showError(`Shortcut handler error: ${err instanceof Error ? err.message : String(err)}`);
					});
					return true;
				}
			}
			return false;
		};
	}

	private createWorkingLoader(): Loader {
		return _createWorkingLoader(this as unknown as ExtensionUiTarget);
	}

	private stopWorkingLoader(): void {
		_stopWorkingLoader(this as unknown as ExtensionUiTarget);
	}

	private resetExtensionUI(): void {
		_resetExtensionUI(this as unknown as ExtensionUiTarget);
	}

	private renderWidgets(): void {
		_renderWidgets(this as unknown as ExtensionUiTarget);
	}

	private addExtensionTerminalInputListener(
		handler: (data: string) => { consume?: boolean; data?: string } | undefined,
	): () => void {
		return _addExtensionTerminalInputListener(this as unknown as ExtensionUiTarget, handler);
	}

	private clearExtensionTerminalInputListeners(): void {
		_clearExtensionTerminalInputListeners(this as unknown as ExtensionUiTarget);
	}

	private createExtensionUIContext(): ExtensionUIContext {
		return _createExtensionUIContext(this as unknown as ExtensionUiTarget);
	}

	private showExtensionSelector(
		title: string,
		options: string[],
		opts?: ExtensionUIDialogOptions,
	): Promise<string | undefined> {
		return _showExtensionSelector(this as unknown as ExtensionUiTarget, title, options, opts);
	}

	private hideExtensionSelector(): void {
		_hideExtensionSelector(this as unknown as ExtensionUiTarget);
	}

	private showExtensionConfirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean> {
		return _showExtensionConfirm(this as unknown as ExtensionUiTarget, title, message, opts);
	}

	private async promptForMissingSessionCwd(error: MissingSessionCwdError): Promise<string | undefined> {
		const confirmed = await this.showExtensionConfirm(
			"Session cwd not found",
			formatMissingSessionCwdPrompt(error.issue),
		);
		return confirmed ? error.issue.fallbackCwd : undefined;
	}

	private showExtensionInput(
		title: string,
		placeholder?: string,
		opts?: ExtensionUIDialogOptions,
	): Promise<string | undefined> {
		return _showExtensionInput(this as unknown as ExtensionUiTarget, title, placeholder, opts);
	}

	private hideExtensionInput(): void {
		_hideExtensionInput(this as unknown as ExtensionUiTarget);
	}

	private showExtensionEditor(title: string, prefill?: string): Promise<string | undefined> {
		return _showExtensionEditor(this as unknown as ExtensionUiTarget, title, prefill);
	}

	private hideExtensionEditor(): void {
		_hideExtensionEditor(this as unknown as ExtensionUiTarget);
	}

	private setCustomEditorComponent(
		factory: ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent) | undefined,
	): void {
		_setCustomEditorComponent(this as unknown as ExtensionUiTarget, factory);
	}

	private showExtensionNotify(message: string, type?: "info" | "warning" | "error"): void {
		_showExtensionNotify(this as unknown as ExtensionUiTarget, message, type);
	}

	private showExtensionCustom<T>(
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

	private showExtensionError(extensionPath: string, error: string, stack?: string): void {
		_showExtensionError(this as unknown as ExtensionUiTarget, extensionPath, error, stack);
	}

	// =========================================================================
	// Key Handlers
	// =========================================================================

	private setupKeyHandlers(): void {
		_setupKeyHandlers(this as unknown as KeyHandlerTarget);
	}

	private setupEditorSubmitHandler(): void {
		const submitTarget = this as unknown as InteractiveSubmitTarget;
		this.defaultEditor.onSubmit = async (text: string) => {
			await _handleEditorSubmit(submitTarget, text);
		};
	}

	private subscribeToAgent(): void {
		this.unsubscribe = this.session.subscribe(async (event) => {
			await this.handleEvent(event);
		});
	}

	private async handleEvent(event: AgentSessionEvent): Promise<void> {
		await _handleInteractiveEvent(this as unknown as InteractiveEventTarget, event);
	}

	private showStatus(message: string): void {
		_showStatus(this as unknown as SessionViewTarget, message);
	}

	private addMessageToChat(message: AgentMessage, options?: { populateHistory?: boolean }): void {
		_addMessageToChat(this as unknown as SessionViewTarget, message, options);
	}

	private renderSessionContext(
		sessionContext: SessionContext,
		options: { updateFooter?: boolean; populateHistory?: boolean } = {},
	): void {
		_renderSessionContext(this as unknown as SessionViewTarget, sessionContext, options);
	}

	renderInitialMessages(): void {
		_renderInitialMessages(this as unknown as SessionViewTarget);
	}

	private rebuildChatFromMessages(): void {
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

	private handleCtrlC(): void {
		_handleCtrlC(this as unknown as SessionControlTarget);
	}
	private handleCtrlD(): void {
		_handleCtrlD(this as unknown as SessionControlTarget);
	}
	private isShuttingDown = false;
	private async shutdown(): Promise<void> {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;
		await _shutdown(this as unknown as SessionControlTarget);
	}
	private async checkShutdownRequested(): Promise<void> {
		await _checkShutdownRequested(this as unknown as SessionControlTarget, this.shutdownRequested);
	}
	private registerSignalHandlers(): void {
		_registerSignalHandlers(this as unknown as SessionControlTarget);
	}
	private unregisterSignalHandlers(): void {
		_unregisterSignalHandlers(this as unknown as SessionControlTarget);
	}
	private handleCtrlZ(): void {
		_handleCtrlZ(this as unknown as SessionControlTarget);
	}
	private async handleFollowUp(): Promise<void> {
		await _handleFollowUp(this as unknown as SessionControlTarget);
	}
	private handleDequeue(): void {
		_handleDequeue(this as unknown as SessionControlTarget);
	}
	private updateEditorBorderColor(): void {
		_updateEditorBorderColor(this as unknown as SessionControlTarget);
	}
	private cycleThinkingLevel(): void {
		_cycleThinkingLevel(this as unknown as SessionControlTarget);
	}
	private async cycleModel(direction: "forward" | "backward"): Promise<void> {
		await _cycleModel(this as unknown as SessionControlTarget, direction, (model) => {
			void this.maybeWarnAboutAnthropicSubscriptionAuth(model);
		});
	}
	private toggleToolOutputExpansion(): void {
		this.setToolsExpanded(!this.toolOutputExpanded);
	}
	private setToolsExpanded(expanded: boolean): void {
		_setToolsExpanded(this as unknown as SessionControlTarget, expanded);
	}
	private toggleThinkingBlockVisibility(): void {
		_toggleThinkingBlockVisibility(this as unknown as SessionControlTarget);
	}
	private openExternalEditor(): void {
		_openExternalEditor(this as unknown as SessionControlTarget);
	}

	clearEditor(): void {
		this.editor.setText("");
		this.ui.requestRender();
	}

	showError(errorMessage: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("error", `Error: ${errorMessage}`), 1, 0));
		this.ui.requestRender();
	}

	showWarning(warningMessage: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0));
		this.ui.requestRender();
	}

	showNewVersionNotification(newVersion: string): void {
		const action = theme.fg("accent", `${APP_NAME} update`);
		const updateInstruction = theme.fg("muted", `New version ${newVersion} is available. Run `) + action;
		const changelogUrl = theme.fg(
			"accent",
			"https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/CHANGELOG.md",
		);
		const changelogLine = theme.fg("muted", "Changelog: ") + changelogUrl;

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.chatContainer.addChild(
			new Text(
				`${theme.bold(theme.fg("warning", "Update Available"))}\n${updateInstruction}\n${changelogLine}`,
				1,
				0,
			),
		);
		this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.ui.requestRender();
	}

	showPackageUpdateNotification(packages: string[]): void {
		const action = theme.fg("accent", `${APP_NAME} update`);
		const updateInstruction = theme.fg("muted", "Package updates are available. Run ") + action;
		const packageLines = packages.map((pkg) => `- ${pkg}`).join("\n");

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.chatContainer.addChild(
			new Text(
				`${theme.bold(theme.fg("warning", "Package Updates Available"))}\n${updateInstruction}\n${theme.fg("muted", "Packages:")}\n${packageLines}`,
				1,
				0,
			),
		);
		this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.ui.requestRender();
	}

	private getAllQueuedMessages(): { steering: string[]; followUp: string[] } {
		return _getAllQueuedMessages(this.session, this.compactionQueuedMessages);
	}

	private clearAllQueues(): { steering: string[]; followUp: string[] } {
		const queuedMessages = _clearAllQueuedMessages(this.session, this.compactionQueuedMessages);
		this.compactionQueuedMessages = [];
		return queuedMessages;
	}

	private updatePendingMessagesDisplay(): void {
		this.pendingMessagesContainer.clear();
		const { steering: steeringMessages, followUp: followUpMessages } = this.getAllQueuedMessages();
		if (steeringMessages.length > 0 || followUpMessages.length > 0) {
			this.pendingMessagesContainer.addChild(new Spacer(1));
			for (const message of steeringMessages) {
				this.pendingMessagesContainer.addChild(new TruncatedText(theme.fg("dim", `Steering: ${message}`), 1, 0));
			}
			for (const message of followUpMessages) {
				this.pendingMessagesContainer.addChild(new TruncatedText(theme.fg("dim", `Follow-up: ${message}`), 1, 0));
			}
			const dequeueHint = this.getAppKeyDisplay("app.message.dequeue");
			this.pendingMessagesContainer.addChild(
				new TruncatedText(theme.fg("dim", `↳ ${dequeueHint} to edit all queued messages`), 1, 0),
			);
		}
	}

	private restoreQueuedMessagesToEditor(options?: { abort?: boolean; currentText?: string }): number {
		const { steering, followUp } = this.clearAllQueues();
		const allQueued = [...steering, ...followUp];
		if (allQueued.length === 0) {
			this.updatePendingMessagesDisplay();
			if (options?.abort) this.agent.abort();
			return 0;
		}
		const queuedText = allQueued.join("\n\n");
		const currentText = options?.currentText ?? this.editor.getText();
		this.editor.setText([queuedText, currentText].filter((t) => t.trim()).join("\n\n"));
		this.updatePendingMessagesDisplay();
		if (options?.abort) this.agent.abort();
		return allQueued.length;
	}

	private queueCompactionMessage(text: string, mode: "steer" | "followUp"): void {
		this.compactionQueuedMessages.push({ text, mode });
		this.editor.addToHistory?.(text);
		this.editor.setText("");
		this.updatePendingMessagesDisplay();
		this.showStatus("Queued message for after compaction");
	}

	private isExtensionCommand(text: string): boolean {
		return _isExtensionCommandText(text, this.session.extensionRunner);
	}

	private async flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void> {
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

	private flushPendingBashComponents(): void {
		for (const component of this.pendingBashComponents) {
			this.pendingMessagesContainer.removeChild(component);
			this.chatContainer.addChild(component);
		}
		this.pendingBashComponents = [];
	}
	private showSelector(create: (done: () => void) => { component: Component; focus: Component }): void {
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

	private showSettingsSelector(): void {
		_showSettingsSelector(this as unknown as SettingsSelectorTarget);
	}

	private async handleModelCommand(searchTerm?: string): Promise<void> {
		await _handleModelCommand(this as unknown as ModelAuthActionsTarget, searchTerm);
	}

	private async findExactModelMatch(searchTerm: string): Promise<Model<Api> | undefined> {
		return _findExactModelMatch(this as unknown as ModelAuthActionsTarget, searchTerm);
	}

	private async getModelCandidates(): Promise<Model<Api>[]> {
		return _getModelCandidates(this as unknown as ModelAuthActionsTarget);
	}

	private async updateAvailableProviderCount(): Promise<void> {
		await _updateAvailableProviderCount(this as unknown as ModelAuthActionsTarget);
	}

	private async maybeWarnAboutAnthropicSubscriptionAuth(model?: Model<Api>): Promise<void> {
		await _maybeWarnAboutAnthropicSubscriptionAuth(this as unknown as ModelAuthActionsTarget, model);
	}

	private showModelSelector(initialSearchInput?: string): void {
		_showModelSelector(this as unknown as ModelSelectorTarget, initialSearchInput);
	}

	private async handleSkillsCommand(searchTerm?: string): Promise<void> {
		await _handleSkillsCommand(this as unknown as SkillSelectorTarget, searchTerm);
	}

	private async showModelsSelector(): Promise<void> {
		await _showModelsSelector(this as unknown as ModelSelectorTarget);
	}

	private showUserMessageSelector(): void {
		_showUserMessageSelector(this as unknown as NavigationSelectorTarget);
	}

	private async handleCloneCommand(): Promise<void> {
		const leafId = this.sessionManager.getLeafId();
		if (!leafId) {
			this.showStatus("Nothing to clone yet");
			return;
		}
		try {
			const result = await this.runtimeHost.fork(leafId, { position: "at" });
			if (result.cancelled) {
				this.ui.requestRender();
				return;
			}
			this.renderCurrentSessionState();
			this.editor.setText("");
			this.showStatus("Cloned to new session");
		} catch (error: unknown) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private showTreeSelector(initialSelectedId?: string): void {
		_showTreeSelector(this as unknown as NavigationSelectorTarget, initialSelectedId);
	}

	private showSessionSelector(): void {
		_showSessionSelector(this as unknown as SessionSelectorTarget);
	}

	private async handleResumeSession(
		sessionPath: string,
		options?: Parameters<ExtensionCommandContext["switchSession"]>[1],
	): Promise<{ cancelled: boolean }> {
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = undefined;
		}
		this.statusContainer.clear();
		try {
			const result = await this.runtimeHost.switchSession(sessionPath, { withSession: options?.withSession });
			if (result.cancelled) return result;
			this.renderCurrentSessionState();
			this.showStatus("Resumed session");
			return result;
		} catch (error: unknown) {
			if (error instanceof MissingSessionCwdError) {
				const selectedCwd = await this.promptForMissingSessionCwd(error);
				if (!selectedCwd) {
					this.showStatus("Resume cancelled");
					return { cancelled: true };
				}
				const result = await this.runtimeHost.switchSession(sessionPath, {
					cwdOverride: selectedCwd,
					withSession: options?.withSession,
				});
				if (result.cancelled) return result;
				this.renderCurrentSessionState();
				this.showStatus("Resumed session in current cwd");
				return result;
			}
			return this.handleFatalRuntimeError("Failed to resume session", error);
		}
	}

	private async showOAuthSelector(mode: "login" | "logout"): Promise<void> {
		await _showOAuthSelector(this as unknown as AuthSelectorTarget, mode);
	}
	private showBedrockSetupDialog(providerId: string, providerName: string): void {
		_showBedrockSetupDialog(this as unknown as AuthDialogTarget, providerId, providerName);
	}
	private async showApiKeyLoginDialog(providerId: string, providerName: string): Promise<void> {
		await _showApiKeyLoginDialog(this as unknown as AuthDialogTarget, providerId, providerName);
	}
	private async showLoginDialog(providerId: string, providerName: string): Promise<void> {
		await _showLoginDialog(this as unknown as AuthDialogTarget, providerId, providerName);
	}
	private async handleReloadCommand(): Promise<void> {
		await _handleReloadCommand(this as unknown as ReloadCommandTarget);
	}
	private async handleExportCommand(text: string): Promise<void> {
		await _handleExportCommand(this as unknown as SessionCommandTarget, text);
	}
	private async handleImportCommand(text: string): Promise<void> {
		await _handleImportCommand(this as unknown as SessionCommandTarget, text);
	}
	private async handleShareCommand(): Promise<void> {
		await _handleShareCommand(this as unknown as InteractiveShareCommandTarget);
	}
	private async handleCopyCommand(): Promise<void> {
		await _handleCopyCommand(this as unknown as SessionCommandTarget);
	}
	private handleNameCommand(text: string): void {
		_handleNameCommand(this as unknown as SessionCommandTarget, text);
	}
	private handleSessionCommand(): void {
		_handleSessionCommand(this as unknown as SessionCommandTarget);
	}
	private handleChangelogCommand(): void {
		_handleChangelogCommand(this as unknown as SessionCommandTarget);
	}
	private capitalizeKey(key: string): string {
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
	private getAppKeyDisplay(action: AppKeybinding): string {
		return this.capitalizeKey(keyText(action));
	}
	private getEditorKeyDisplay(action: Keybinding): string {
		return this.capitalizeKey(keyText(action));
	}
	private handleHotkeysCommand(): void {
		_handleHotkeysCommand(this as unknown as LowerCommandActionsTarget, process.platform);
	}
	private handleArminSaysHi(): void {
		_handleArminSaysHi(this as unknown as LowerCommandActionsTarget);
	}
	private handleDementedDelves(): void {
		_handleDementedDelves(this as unknown as LowerCommandActionsTarget);
	}
	private handleDaxnuts(): void {
		_handleDaxnuts(this as unknown as LowerCommandActionsTarget);
	}
	private checkDaxnutsEasterEgg(model: { provider: string; id: string }): void {
		_checkDaxnutsEasterEgg(this as unknown as LowerCommandActionsTarget, model);
	}
	private async handleClearCommand(): Promise<void> {
		await _handleClearCommand(this as unknown as SessionCommandTarget);
	}

	private handleDebugCommand(): void {
		_handleDebugCommand(this as unknown as SessionCommandTarget);
	}

	private async handleBashCommand(command: string, excludeFromContext = false): Promise<void> {
		await _handleBashCommand(this as unknown as InteractiveBashCommandTarget, command, excludeFromContext);
	}
	private async handleCompactCommand(customInstructions?: string): Promise<void> {
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
