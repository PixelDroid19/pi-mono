/**
 * Shared state and constructor wiring for InteractiveMode.
 *
 * The public InteractiveMode class owns behavior through small controller
 * methods. This base class owns long-lived TUI objects, session accessors, and
 * compatibility adapters used by existing tests and extension-facing helpers.
 * Keeping the mutable fields in one place makes controller modules easier to
 * type structurally without importing the concrete InteractiveMode class.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type {
	AutocompleteProvider,
	EditorComponent,
	EditorTheme,
	Loader,
	LoaderIndicatorOptions,
	Spacer,
	Text,
} from "@mariozechner/pi-tui";
import { type Component, Container, ProcessTerminal, setKeybindings, TUI } from "@mariozechner/pi-tui";
import { VERSION } from "../../../config.js";
import type { AgentSession, AgentSessionEvent } from "../../../core/agent-session.js";
import type { AgentSessionRuntime } from "../../../core/agent-session-runtime.js";
import type { AutocompleteProviderFactory } from "../../../core/extensions/index.js";
import { FooterDataProvider } from "../../../core/footer-data-provider.js";
import { KeybindingsManager } from "../../../core/keybindings.js";
import type { SourceInfo } from "../../../core/source-info.js";
import type { AssistantMessageComponent } from "../components/assistant-message.js";
import type { BashExecutionComponent } from "../components/bash-execution.js";
import type { CountdownTimer } from "../components/countdown-timer.js";
import { CustomEditor } from "../components/custom-editor.js";
import type { ExtensionEditorComponent } from "../components/extension-editor.js";
import type { ExtensionInputComponent } from "../components/extension-input.js";
import type { ExtensionSelectorComponent } from "../components/extension-selector.js";
import { FooterComponent } from "../components/footer.js";
import type { ToolExecutionComponent } from "../components/tool-execution.js";
import { getEditorTheme, initTheme, setRegisteredThemes } from "../theme/theme.js";
import { parsePathCommandArgument as _parsePathCommandArgument } from "./commands.js";
import type { InteractiveModeOptions } from "./interactive-mode-options.js";
import {
	buildScopeGroups as _buildScopeGroups,
	formatScopeGroups as _formatScopeGroups,
	getCompactDisplayPathSegments as _getCompactDisplayPathSegments,
	getCompactExtensionLabels as _getCompactExtensionLabels,
	getCompactNonPackageExtensionLabel as _getCompactNonPackageExtensionLabel,
	getCompactPathLabel as _getCompactPathLabel,
} from "./loaded-resources.js";
import {
	formatContextPath as _formatContextPath,
	formatDisplayPath as _formatDisplayPath,
	getAutocompleteSourceTag as _getAutocompleteSourceTag,
	getScopeGroup as _getScopeGroup,
	getShortPath as _getShortPath,
	isPackageSource as _isPackageSource,
} from "./resource-display.js";
import type { CompactionQueuedMessage } from "./session-queue.js";

/**
 * Mutable state container shared by the interactive-mode controller modules.
 *
 * Subclasses provide the behavior that can be invoked from runtime callbacks.
 * The constructor is the only place where process terminal objects are created,
 * so tests can instantiate InteractiveMode without duplicating setup logic.
 */
export abstract class InteractiveModeState {
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
	protected lastStatusSpacer: Spacer | undefined = undefined;
	protected lastStatusText: Text | undefined = undefined;
	protected streamingComponent: AssistantMessageComponent | undefined = undefined;
	protected streamingMessage: AssistantMessage | undefined = undefined;
	protected pendingTools = new Map<string, ToolExecutionComponent>();
	protected toolOutputExpanded = false;
	protected hideThinkingBlock = false;
	protected skillCommands = new Map<string, string>();
	protected unsubscribe?: () => void;
	protected signalCleanupHandlers: Array<() => void> = [];
	protected isBashMode = false;
	protected bashComponent: BashExecutionComponent | undefined = undefined;
	protected pendingBashComponents: BashExecutionComponent[] = [];
	protected autoCompactionLoader: Loader | undefined = undefined;
	protected autoCompactionEscapeHandler?: () => void;
	protected retryLoader: Loader | undefined = undefined;
	protected retryCountdown: CountdownTimer | undefined = undefined;
	protected retryEscapeHandler?: () => void;
	protected compactionQueuedMessages: CompactionQueuedMessage[] = [];
	protected shutdownRequested = false;
	protected extensionSelector: ExtensionSelectorComponent | undefined = undefined;
	protected extensionInput: ExtensionInputComponent | undefined = undefined;
	protected extensionEditor: ExtensionEditorComponent | undefined = undefined;
	protected editorComponentFactory:
		| ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent)
		| undefined = undefined;
	protected extensionTerminalInputUnsubscribers = new Set<() => void>();
	protected extensionWidgetsAbove = new Map<string, Component & { dispose?(): void }>();
	protected extensionWidgetsBelow = new Map<string, Component & { dispose?(): void }>();
	protected widgetContainerAbove!: Container;
	protected widgetContainerBelow!: Container;
	protected customFooter: (Component & { dispose?(): void }) | undefined = undefined;
	protected headerContainer: Container;
	protected builtInHeader: Component | undefined = undefined;
	protected customHeader: (Component & { dispose?(): void }) | undefined = undefined;
	protected isShuttingDown = false;

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

	protected constructor(
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
		this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
		setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
		initTheme(this.settingsManager.getTheme(), true);
	}

	protected abstract resetExtensionUI(): void;
	protected abstract rebindCurrentSession(): Promise<void>;

	protected getAutocompleteSourceTag(sourceInfo?: SourceInfo): string | undefined {
		return _getAutocompleteSourceTag(sourceInfo);
	}

	protected formatDisplayPath(resourcePath: string): string {
		return _formatDisplayPath(resourcePath);
	}

	protected formatContextPath(resourcePath: string): string {
		return _formatContextPath(resourcePath, this.sessionManager.getCwd());
	}

	protected isPackageSource(sourceInfo?: SourceInfo): boolean {
		return _isPackageSource(sourceInfo);
	}

	protected getScopeGroup(sourceInfo?: SourceInfo): "user" | "project" | "path" {
		return _getScopeGroup(sourceInfo);
	}

	protected getShortPath(fullPath: string, sourceInfo?: SourceInfo): string {
		return _getShortPath(fullPath, sourceInfo);
	}

	protected getCompactPathLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
		return _getCompactPathLabel(resourcePath, sourceInfo);
	}

	protected getCompactDisplayPathSegments(resourcePath: string): string[] {
		return _getCompactDisplayPathSegments(resourcePath);
	}

	protected getCompactNonPackageExtensionLabel(
		resourcePath: string,
		index: number,
		allPaths: Array<{ path: string; segments: string[] }>,
	): string {
		return _getCompactNonPackageExtensionLabel(resourcePath, index, allPaths);
	}

	protected getCompactExtensionLabels(extensions: Array<{ path: string; sourceInfo?: SourceInfo }>): string[] {
		return _getCompactExtensionLabels(extensions);
	}

	protected buildScopeGroups(items: Array<{ path: string; sourceInfo?: SourceInfo }>): unknown {
		return _buildScopeGroups(items);
	}

	protected formatScopeGroups(
		groups: unknown,
		options: {
			formatPackagePath: (item: { path: string; sourceInfo?: SourceInfo }, source: string) => string;
			formatPath: (item: { path: string; sourceInfo?: SourceInfo }) => string;
		},
	): string {
		return _formatScopeGroups(groups as ReturnType<typeof _buildScopeGroups>, options);
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

	protected getPathCommandArgument(text: string, command: "/export" | "/import"): string | undefined {
		return _parsePathCommandArgument(text, command);
	}

	protected abstract handleEvent(event: AgentSessionEvent): Promise<void>;
	protected abstract addMessageToChat(message: AgentMessage, options?: { populateHistory?: boolean }): void;
}
