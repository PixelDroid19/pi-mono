/**
 * AgentSession - Core abstraction for agent lifecycle and session management.
 *
 * This class is shared between all run modes (interactive, print, rpc).
 * It encapsulates:
 * - Agent state access
 * - Event subscription with automatic session persistence
 * - Model and thinking level management
 * - Compaction (manual and auto)
 * - Bash execution
 * - Session switching and branching
 *
 * Modes use this class and add their own I/O layer on top.
 */

import type {
	Agent,
	AgentEvent,
	AgentMessage,
	AgentState,
	AgentTool,
	ThinkingLevel,
} from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ImageContent, Message, Model, TextContent } from "@mariozechner/pi-ai";
import {
	type AgentSessionActiveToolTarget,
	type AgentSessionBashTarget,
	type AgentSessionCompactionTarget,
	type AgentSessionCustomMessageTarget,
	type AgentSessionEventTarget,
	type AgentSessionExportTarget,
	type AgentSessionLifecycleTarget,
	type AgentSessionModelTarget,
	type AgentSessionPromptTarget,
	type AgentSessionReloadTarget,
	type AgentSessionToolHookTarget,
	type AgentSessionTreeTarget,
	abortRetry as abortSessionRetry,
	applyExtensionBindings,
	bindExtensionCore,
	bindSessionExtensions,
	buildExtensionResourcePaths,
	buildRuntime,
	checkSessionCompaction,
	clampThinkingLevel,
	compactSession,
	createRetryPromiseForAgentEnd,
	cycleSessionModel,
	cycleSessionThinkingLevel,
	disconnectSessionAgent,
	disposeSession,
	emitExtensionEvent,
	emitModelSelect,
	emitSessionEvent,
	executeSessionBash,
	expandSessionSkillCommand,
	exportSessionHtml,
	exportSessionJsonl,
	extendResourcesFromExtensions,
	extractUserMessageText,
	findLastAssistantInMessages,
	findLastAssistantMessage,
	flushPendingBashMessages,
	followUpSession,
	getExtensionSourceLabel,
	getLastAssistantText,
	getActiveToolNames as getSessionActiveToolNames,
	getAllTools as getSessionAllTools,
	getAvailableThinkingLevels as getSessionAvailableThinkingLevels,
	getSessionContextUsage,
	getSessionStats as getSessionStatistics,
	getToolDefinition as getSessionToolDefinition,
	getThinkingLevelForModelSwitch,
	getUserMessagesForSessionForking,
	getUserMessageText,
	handleRetryableError,
	installAgentToolHooks,
	isRetryableAssistantError,
	navigateSessionTree,
	processAgentEvent,
	promptSession,
	queueFollowUpMessage,
	queueSteeringMessage,
	rebuildSessionSystemPrompt,
	reconnectSessionAgent,
	recordSessionBashResult,
	refreshCurrentModelFromRegistry,
	refreshToolRegistry,
	reloadSession,
	resolveRetry,
	runAutoCompaction,
	sendSessionCustomMessage,
	sendSessionUserMessage,
	setActiveToolsByName as setSessionActiveToolsByName,
	setSessionModel,
	setSessionThinkingLevel,
	steerSession,
	subscribeToSessionEvents,
	supportsSessionThinking,
	supportsSessionXhighThinking,
	throwIfExtensionCommand,
	tryExecuteExtensionCommand,
	waitForRetry as waitForSessionRetry,
} from "./agent-session-internal/index.js";
import {
	normalizePromptGuidelines as _normalizePromptGuidelines,
	normalizePromptSnippet as _normalizePromptSnippet,
	type ToolDefinitionEntry,
} from "./agent-session-internal/tool-registry.js";
import { formatNoApiKeyFoundMessage } from "./auth-guidance.js";
import type { BashResult } from "./bash-executor.js";
import type { CompactionResult } from "./compaction/index.js";
import type {
	ContextUsage,
	ExtensionCommandContextActions,
	ExtensionErrorListener,
	ExtensionRunner,
	ExtensionUIContext,
	ReplacedSessionContext,
	SessionStartEvent,
	ShutdownHandler,
	ToolDefinition,
	ToolInfo,
} from "./extensions/index.js";
import type { BashExecutionMessage, CustomMessage } from "./messages.js";
import type { ModelRegistry } from "./model-registry.js";
import type { PromptTemplate } from "./prompt-templates.js";
import type { ResourceLoader } from "./resource-loader.js";
import type { BranchSummaryEntry, SessionManager } from "./session-manager.js";
import type { SettingsManager } from "./settings-manager.js";
import type { BuildSystemPromptOptions } from "./system-prompt.js";
import type { BashOperations } from "./tools/bash.js";

export type {
	AgentSessionConfig,
	AgentSessionEvent,
	AgentSessionEventListener,
	ExtensionBindings,
	ModelCycleResult,
	ParsedSkillBlock,
	PromptOptions,
	SessionStats,
} from "./agent-session-contract.js";
export { parseSkillBlock } from "./agent-session-contract.js";

import type {
	AgentSessionConfig,
	AgentSessionEvent,
	AgentSessionEventListener,
	ExtensionBindings,
	ModelCycleResult,
	PromptOptions,
	SessionStats,
} from "./agent-session-contract.js";

// ============================================================================
// AgentSession Class
// ============================================================================

export class AgentSession {
	readonly agent: Agent;
	readonly sessionManager: SessionManager;
	readonly settingsManager: SettingsManager;

	private _scopedModels: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;

	// Event subscription state
	private _unsubscribeAgent?: () => void;
	private _eventListeners: AgentSessionEventListener[] = [];
	private _agentEventQueue: Promise<void> = Promise.resolve();

	/** Tracks pending steering messages for UI display. Removed when delivered. */
	private _steeringMessages: string[] = [];
	/** Tracks pending follow-up messages for UI display. Removed when delivered. */
	private _followUpMessages: string[] = [];
	/** Messages queued to be included with the next user prompt as context ("asides"). */
	private _pendingNextTurnMessages: CustomMessage[] = [];

	// Compaction state
	private _compactionAbortController: AbortController | undefined = undefined;
	private _autoCompactionAbortController: AbortController | undefined = undefined;
	private _overflowRecoveryAttempted = false;

	// Branch summarization state
	private _branchSummaryAbortController: AbortController | undefined = undefined;

	// Retry state
	private _retryAbortController: AbortController | undefined = undefined;
	private _retryAttempt = 0;
	private _retryPromise: Promise<void> | undefined = undefined;
	private _retryResolve: (() => void) | undefined = undefined;

	// Bash execution state
	private _bashAbortController: AbortController | undefined = undefined;
	private _pendingBashMessages: BashExecutionMessage[] = [];

	// Extension system
	private _extensionRunner!: ExtensionRunner;
	private _turnIndex = 0;

	private _resourceLoader: ResourceLoader;
	private _customTools: ToolDefinition[];
	private _baseToolDefinitions: Map<string, ToolDefinition> = new Map();
	private _cwd: string;
	private _extensionRunnerRef?: { current?: ExtensionRunner };
	private _initialActiveToolNames?: string[];
	private _allowedToolNames?: Set<string>;
	private _baseToolsOverride?: Record<string, AgentTool>;
	private _sessionStartEvent: SessionStartEvent;
	private _extensionUIContext?: ExtensionUIContext;
	private _extensionCommandContextActions?: ExtensionCommandContextActions;
	private _extensionShutdownHandler?: ShutdownHandler;
	private _extensionErrorListener?: ExtensionErrorListener;
	private _extensionErrorUnsubscriber?: () => void;

	// Model registry for API key resolution
	private _modelRegistry: ModelRegistry;

	// Tool registry for extension getTools/setTools
	private _toolRegistry: Map<string, AgentTool> = new Map();
	private _toolDefinitions: Map<string, ToolDefinitionEntry> = new Map();
	private _toolPromptSnippets: Map<string, string> = new Map();
	private _toolPromptGuidelines: Map<string, string[]> = new Map();

	// Base system prompt (without extension appends) - used to apply fresh appends each turn
	private _baseSystemPrompt = "";
	private _baseSystemPromptOptions!: BuildSystemPromptOptions;

	private get _delegatedMemberRefs(): unknown[] {
		return [
			this._unsubscribeAgent,
			this._eventListeners,
			this._lastAssistantMessage,
			this._retryAbortController,
			this._retryResolve,
			this._pendingNextTurnMessages,
			this._overflowRecoveryAttempted,
			this._turnIndex,
			this._customTools,
			this._baseToolDefinitions,
			this._cwd,
			this._extensionRunnerRef,
			this._allowedToolNames,
			this._baseToolsOverride,
			this._sessionStartEvent,
			this._extensionUIContext,
			this._extensionCommandContextActions,
			this._extensionShutdownHandler,
			this._extensionErrorListener,
			this._extensionErrorUnsubscriber,
			this._toolRegistry,
			this._toolDefinitions,
			this._toolPromptSnippets,
			this._toolPromptGuidelines,
			this._baseSystemPrompt,
			this._baseSystemPromptOptions,
			this._getRequiredRequestAuth,
			this._disconnectFromAgent,
			this._reconnectToAgent,
			this._findLastAssistantInMessages,
			this._resolveRetry,
			this._getUserMessageText,
			this._findLastAssistantMessage,
			this._emitExtensionEvent,
			this._normalizePromptSnippet,
			this._normalizePromptGuidelines,
			this._rebuildSystemPrompt,
			this._tryExecuteExtensionCommand,
			this._expandSkillCommand,
			this._queueSteer,
			this._queueFollowUp,
			this._throwIfExtensionCommand,
			this._emitModelSelect,
			this._cycleScopedModel,
			this._cycleAvailableModel,
			this._getThinkingLevelForModelSwitch,
			this._clampThinkingLevel,
			this._checkCompaction,
			this._runAutoCompaction,
			this.extendResourcesFromExtensions,
			this.buildExtensionResourcePaths,
			this.getExtensionSourceLabel,
			this._applyExtensionBindings,
			this._refreshCurrentModelFromRegistry,
			this._bindExtensionCore,
			this._refreshToolRegistry,
			this._buildRuntime,
			this._handleRetryableError,
			this._isRetryableError,
			this._flushPendingBashMessages,
			this._extractUserMessageText,
			this._waitForAgentEvents,
			this.waitForRetry,
		];
	}

	constructor(config: AgentSessionConfig) {
		this.agent = config.agent;
		this.sessionManager = config.sessionManager;
		this.settingsManager = config.settingsManager;
		this._scopedModels = config.scopedModels ?? [];
		this._resourceLoader = config.resourceLoader;
		this._customTools = config.customTools ?? [];
		this._cwd = config.cwd;
		this._modelRegistry = config.modelRegistry;
		this._extensionRunnerRef = config.extensionRunnerRef;
		this._initialActiveToolNames = config.initialActiveToolNames;
		this._allowedToolNames = config.allowedToolNames ? new Set(config.allowedToolNames) : undefined;
		this._baseToolsOverride = config.baseToolsOverride;
		this._sessionStartEvent = config.sessionStartEvent ?? { type: "session_start", reason: "startup" };
		void this._delegatedMemberRefs;

		// Always subscribe to agent events for internal handling
		// (session persistence, extensions, auto-compaction, retry logic)
		this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
		this._installAgentToolHooks();

		this._buildRuntime({
			activeToolNames: this._initialActiveToolNames,
			includeAllExtensionTools: true,
		});
	}

	/** Model registry for API key resolution and model discovery */
	get modelRegistry(): ModelRegistry {
		return this._modelRegistry;
	}

	private async _getRequiredRequestAuth(model: Model<any>): Promise<{
		apiKey: string;
		headers?: Record<string, string>;
	}> {
		const result = await this._modelRegistry.getApiKeyAndHeaders(model);
		if (!result.ok) {
			if (result.error.startsWith("No API key found")) {
				throw new Error(formatNoApiKeyFoundMessage(model.provider));
			}
			throw new Error(result.error);
		}
		if (result.apiKey) {
			return { apiKey: result.apiKey, headers: result.headers };
		}

		const isOAuth = this._modelRegistry.isUsingOAuth(model);
		if (isOAuth) {
			throw new Error(
				`Authentication failed for "${model.provider}". ` +
					`Credentials may have expired or network is unavailable. ` +
					`Run '/login ${model.provider}' to re-authenticate.`,
			);
		}
		throw new Error(formatNoApiKeyFoundMessage(model.provider));
	}

	/**
	 * Install tool hooks once on the Agent instance.
	 *
	 * The callbacks read `this._extensionRunner` at execution time, so extension reload swaps in the
	 * new runner without reinstalling hooks. Extension-specific tool wrappers are still used to adapt
	 * registered tool execution to the extension context. Tool call and tool result interception now
	 * happens here instead of in wrappers.
	 */
	private _installAgentToolHooks(): void {
		installAgentToolHooks(this as unknown as AgentSessionToolHookTarget);
	}

	// =========================================================================
	// Event Subscription
	// =========================================================================

	/** Emit an event to all listeners */
	private _emit(event: AgentSessionEvent): void {
		emitSessionEvent(this as unknown as AgentSessionLifecycleTarget, event);
	}

	private _emitQueueUpdate(): void {
		this._emit({
			type: "queue_update",
			steering: [...this._steeringMessages],
			followUp: [...this._followUpMessages],
		});
	}

	// Track last assistant message for auto-compaction check
	private _lastAssistantMessage: AssistantMessage | undefined = undefined;

	/** Internal handler for agent events - shared by subscribe and reconnect */
	private _handleAgentEvent = (event: AgentEvent): void => {
		// Create retry promise synchronously before queueing async processing.
		// Agent.emit() calls this handler synchronously, and prompt() calls waitForRetry()
		// as soon as agent.prompt() resolves. If _retryPromise is created only inside
		// _processAgentEvent, slow earlier queued events can delay agent_end processing
		// and waitForRetry() can miss the in-flight retry.
		this._createRetryPromiseForAgentEnd(event);

		this._agentEventQueue = this._agentEventQueue.then(
			() => this._processAgentEvent(event),
			() => this._processAgentEvent(event),
		);

		// Keep queue alive if an event handler fails
		this._agentEventQueue.catch(() => {});
	};

	private _createRetryPromiseForAgentEnd(event: AgentEvent): void {
		createRetryPromiseForAgentEnd(this as unknown as AgentSessionEventTarget, event);
	}

	private _findLastAssistantInMessages(messages: AgentMessage[]): AssistantMessage | undefined {
		return findLastAssistantInMessages(messages);
	}

	private async _processAgentEvent(event: AgentEvent): Promise<void> {
		await processAgentEvent(this as unknown as AgentSessionEventTarget, event);
	}

	private async _waitForAgentEvents(): Promise<void> {
		await this._agentEventQueue.catch(() => {});
	}

	/** Resolve the pending retry promise */
	private _resolveRetry(): void {
		resolveRetry(this as unknown as AgentSessionEventTarget);
	}

	/** Extract text content from a message */
	private _getUserMessageText(message: Message): string {
		return getUserMessageText(message);
	}

	/** Find the last assistant message in agent state (including aborted ones) */
	private _findLastAssistantMessage(): AssistantMessage | undefined {
		return findLastAssistantMessage(this.agent.state.messages);
	}

	/** Emit extension events based on agent events */
	private async _emitExtensionEvent(event: AgentEvent): Promise<void> {
		await emitExtensionEvent(this as unknown as AgentSessionEventTarget, event);
	}

	/**
	 * Subscribe to agent events.
	 * Session persistence is handled internally (saves messages on message_end).
	 * Multiple listeners can be added. Returns unsubscribe function for this listener.
	 */
	subscribe(listener: AgentSessionEventListener): () => void {
		return subscribeToSessionEvents(this as unknown as AgentSessionLifecycleTarget, listener);
	}

	/**
	 * Temporarily disconnect from agent events.
	 * User listeners are preserved and will receive events again after resubscribe().
	 * Used internally during operations that need to pause event processing.
	 */
	private _disconnectFromAgent(): void {
		disconnectSessionAgent(this as unknown as AgentSessionLifecycleTarget);
	}

	/**
	 * Reconnect to agent events after _disconnectFromAgent().
	 * Preserves all existing listeners.
	 */
	private _reconnectToAgent(): void {
		reconnectSessionAgent(this as unknown as AgentSessionLifecycleTarget);
	}

	/**
	 * Remove all listeners and disconnect from agent.
	 * Call this when completely done with the session.
	 */
	dispose(): void {
		disposeSession(this as unknown as AgentSessionLifecycleTarget);
	}

	// =========================================================================
	// Read-only State Access
	// =========================================================================

	/** Full agent state */
	get state(): AgentState {
		return this.agent.state;
	}

	/** Current model (may be undefined if not yet selected) */
	get model(): Model<any> | undefined {
		return this.agent.state.model;
	}

	/** Current thinking level */
	get thinkingLevel(): ThinkingLevel {
		return this.agent.state.thinkingLevel;
	}

	/** Whether agent is currently streaming a response */
	get isStreaming(): boolean {
		return this.agent.state.isStreaming;
	}

	/** Current effective system prompt (includes any per-turn extension modifications) */
	get systemPrompt(): string {
		return this.agent.state.systemPrompt;
	}

	/** Current retry attempt (0 if not retrying) */
	get retryAttempt(): number {
		return this._retryAttempt;
	}

	/**
	 * Get the names of currently active tools.
	 * Returns the names of tools currently set on the agent.
	 */
	getActiveToolNames(): string[] {
		return getSessionActiveToolNames(this as unknown as AgentSessionActiveToolTarget);
	}

	/**
	 * Get all configured tools with name, description, parameter schema, and source metadata.
	 */
	getAllTools(): ToolInfo[] {
		return getSessionAllTools(this as unknown as AgentSessionActiveToolTarget);
	}

	getToolDefinition(name: string): ToolDefinition | undefined {
		return getSessionToolDefinition(this as unknown as AgentSessionActiveToolTarget, name);
	}

	/**
	 * Set active tools by name.
	 * Only tools in the registry can be enabled. Unknown tool names are ignored.
	 * Also rebuilds the system prompt to reflect the new tool set.
	 * Changes take effect on the next agent turn.
	 */
	setActiveToolsByName(toolNames: string[]): void {
		setSessionActiveToolsByName(this as unknown as AgentSessionActiveToolTarget, toolNames);
	}

	/** Whether compaction or branch summarization is currently running */
	get isCompacting(): boolean {
		return (
			this._autoCompactionAbortController !== undefined ||
			this._compactionAbortController !== undefined ||
			this._branchSummaryAbortController !== undefined
		);
	}

	/** All messages including custom types like BashExecutionMessage */
	get messages(): AgentMessage[] {
		return this.agent.state.messages;
	}

	/** Current steering mode */
	get steeringMode(): "all" | "one-at-a-time" {
		return this.agent.steeringMode;
	}

	/** Current follow-up mode */
	get followUpMode(): "all" | "one-at-a-time" {
		return this.agent.followUpMode;
	}

	/** Current session file path, or undefined if sessions are disabled */
	get sessionFile(): string | undefined {
		return this.sessionManager.getSessionFile();
	}

	/** Current session ID */
	get sessionId(): string {
		return this.sessionManager.getSessionId();
	}

	/** Current session display name, if set */
	get sessionName(): string | undefined {
		return this.sessionManager.getSessionName();
	}

	/** Scoped models for cycling (from --models flag) */
	get scopedModels(): ReadonlyArray<{ model: Model<any>; thinkingLevel?: ThinkingLevel }> {
		return this._scopedModels;
	}

	/** Update scoped models for cycling */
	setScopedModels(scopedModels: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>): void {
		this._scopedModels = scopedModels;
	}

	/** File-based prompt templates */
	get promptTemplates(): ReadonlyArray<PromptTemplate> {
		return this._resourceLoader.getPrompts().prompts;
	}

	private _normalizePromptSnippet(text: string | undefined): string | undefined {
		return _normalizePromptSnippet(text);
	}

	private _normalizePromptGuidelines(guidelines: string[] | undefined): string[] {
		return _normalizePromptGuidelines(guidelines);
	}

	private _rebuildSystemPrompt(toolNames: string[]): string {
		return rebuildSessionSystemPrompt(this as unknown as AgentSessionModelTarget, toolNames);
	}

	// =========================================================================
	// Prompting
	// =========================================================================

	/**
	 * Send a prompt to the agent.
	 * - Handles extension commands (registered via pi.registerCommand) immediately, even during streaming
	 * - Expands file-based prompt templates by default
	 * - During streaming, queues via steer() or followUp() based on streamingBehavior option
	 * - Validates model and API key before sending (when not streaming)
	 * @throws Error if streaming and no streamingBehavior specified
	 * @throws Error if no model selected or no API key available (when not streaming)
	 */
	async prompt(text: string, options?: PromptOptions): Promise<void> {
		await promptSession(this as unknown as AgentSessionPromptTarget, text, options);
	}

	/**
	 * Try to execute an extension command. Returns true if command was found and executed.
	 */
	private async _tryExecuteExtensionCommand(text: string): Promise<boolean> {
		return tryExecuteExtensionCommand(this as unknown as AgentSessionPromptTarget, text);
	}

	/**
	 * Expand skill commands (/skill:name args) to their full content.
	 * Returns the expanded text, or the original text if not a skill command or skill not found.
	 * Emits errors via extension runner if file read fails.
	 */
	private _expandSkillCommand(text: string): string {
		return expandSessionSkillCommand(this as unknown as AgentSessionPromptTarget, text);
	}

	/**
	 * Queue a steering message while the agent is running.
	 * Delivered after the current assistant turn finishes executing its tool calls,
	 * before the next LLM call.
	 * Expands skill commands and prompt templates. Errors on extension commands.
	 * @param images Optional image attachments to include with the message
	 * @throws Error if text is an extension command
	 */
	async steer(text: string, images?: ImageContent[]): Promise<void> {
		await steerSession(this as unknown as AgentSessionPromptTarget, text, images);
	}

	/**
	 * Queue a follow-up message to be processed after the agent finishes.
	 * Delivered only when agent has no more tool calls or steering messages.
	 * Expands skill commands and prompt templates. Errors on extension commands.
	 * @param images Optional image attachments to include with the message
	 * @throws Error if text is an extension command
	 */
	async followUp(text: string, images?: ImageContent[]): Promise<void> {
		await followUpSession(this as unknown as AgentSessionPromptTarget, text, images);
	}

	/**
	 * Internal: Queue a steering message (already expanded, no extension command check).
	 */
	private async _queueSteer(text: string, images?: ImageContent[]): Promise<void> {
		await queueSteeringMessage(this as unknown as AgentSessionPromptTarget, text, images);
	}

	/**
	 * Internal: Queue a follow-up message (already expanded, no extension command check).
	 */
	private async _queueFollowUp(text: string, images?: ImageContent[]): Promise<void> {
		await queueFollowUpMessage(this as unknown as AgentSessionPromptTarget, text, images);
	}

	/**
	 * Throw an error if the text is an extension command.
	 */
	private _throwIfExtensionCommand(text: string): void {
		throwIfExtensionCommand(this as unknown as AgentSessionPromptTarget, text);
	}

	/**
	 * Send a custom message to the session. Creates a CustomMessageEntry.
	 *
	 * Handles three cases:
	 * - Streaming: queues message, processed when loop pulls from queue
	 * - Not streaming + triggerTurn: appends to state/session, starts new turn
	 * - Not streaming + no trigger: appends to state/session, no turn
	 *
	 * @param message Custom message with customType, content, display, details
	 * @param options.triggerTurn If true and not streaming, triggers a new LLM turn
	 * @param options.deliverAs Delivery mode: "steer", "followUp", or "nextTurn"
	 */
	async sendCustomMessage<T = unknown>(
		message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
		options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
	): Promise<void> {
		await sendSessionCustomMessage(this as unknown as AgentSessionCustomMessageTarget, message, options);
	}

	/**
	 * Send a user message to the agent. Always triggers a turn.
	 * When the agent is streaming, use deliverAs to specify how to queue the message.
	 *
	 * @param content User message content (string or content array)
	 * @param options.deliverAs Delivery mode when streaming: "steer" or "followUp"
	 */
	async sendUserMessage(
		content: string | (TextContent | ImageContent)[],
		options?: { deliverAs?: "steer" | "followUp" },
	): Promise<void> {
		await sendSessionUserMessage(this as unknown as AgentSessionCustomMessageTarget, content, options);
	}

	/**
	 * Clear all queued messages and return them.
	 * Useful for restoring to editor when user aborts.
	 * @returns Object with steering and followUp arrays
	 */
	clearQueue(): { steering: string[]; followUp: string[] } {
		const steering = [...this._steeringMessages];
		const followUp = [...this._followUpMessages];
		this._steeringMessages = [];
		this._followUpMessages = [];
		this.agent.clearAllQueues();
		this._emitQueueUpdate();
		return { steering, followUp };
	}

	/** Number of pending messages (includes both steering and follow-up) */
	get pendingMessageCount(): number {
		return this._steeringMessages.length + this._followUpMessages.length;
	}

	/** Get pending steering messages (read-only) */
	getSteeringMessages(): readonly string[] {
		return this._steeringMessages;
	}

	/** Get pending follow-up messages (read-only) */
	getFollowUpMessages(): readonly string[] {
		return this._followUpMessages;
	}

	get resourceLoader(): ResourceLoader {
		return this._resourceLoader;
	}

	/**
	 * Abort current operation and wait for agent to become idle.
	 */
	async abort(): Promise<void> {
		this.abortRetry();
		this.agent.abort();
		await this.agent.waitForIdle();
	}

	// =========================================================================
	// Model Management
	// =========================================================================

	private async _emitModelSelect(
		nextModel: Model<any>,
		previousModel: Model<any> | undefined,
		source: "set" | "cycle" | "restore",
	): Promise<void> {
		await emitModelSelect(this as unknown as AgentSessionModelTarget, nextModel, previousModel, source);
	}

	/**
	 * Set model directly.
	 * Validates that auth is configured, saves to session and settings.
	 * @throws Error if no auth is configured for the model
	 */
	async setModel(model: Model<any>): Promise<void> {
		await setSessionModel(this as unknown as AgentSessionModelTarget, model);
	}

	/**
	 * Cycle to next/previous model.
	 * Uses scoped models (from --models flag) if available, otherwise all available models.
	 * @param direction - "forward" (default) or "backward"
	 * @returns The new model info, or undefined if only one model available
	 */
	async cycleModel(direction: "forward" | "backward" = "forward"): Promise<ModelCycleResult | undefined> {
		return cycleSessionModel(this as unknown as AgentSessionModelTarget, direction);
	}

	private async _cycleScopedModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		return cycleSessionModel(this as unknown as AgentSessionModelTarget, direction);
	}

	private async _cycleAvailableModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		return cycleSessionModel(this as unknown as AgentSessionModelTarget, direction);
	}

	// =========================================================================
	// Thinking Level Management
	// =========================================================================

	/**
	 * Set thinking level.
	 * Clamps to model capabilities based on available thinking levels.
	 * Saves to session and settings only if the level actually changes.
	 */
	setThinkingLevel(level: ThinkingLevel): void {
		setSessionThinkingLevel(this as unknown as AgentSessionModelTarget, level);
	}

	/**
	 * Cycle to next thinking level.
	 * @returns New level, or undefined if model doesn't support thinking
	 */
	cycleThinkingLevel(): ThinkingLevel | undefined {
		return cycleSessionThinkingLevel(this as unknown as AgentSessionModelTarget);
	}

	/**
	 * Get available thinking levels for current model.
	 * The provider will clamp to what the specific model supports internally.
	 */
	getAvailableThinkingLevels(): ThinkingLevel[] {
		return getSessionAvailableThinkingLevels(this as unknown as AgentSessionModelTarget);
	}

	/**
	 * Check if current model supports xhigh thinking level.
	 */
	supportsXhighThinking(): boolean {
		return supportsSessionXhighThinking(this as unknown as AgentSessionModelTarget);
	}

	/**
	 * Check if current model supports thinking/reasoning.
	 */
	supportsThinking(): boolean {
		return supportsSessionThinking(this as unknown as AgentSessionModelTarget);
	}

	private _getThinkingLevelForModelSwitch(explicitLevel?: ThinkingLevel): ThinkingLevel {
		return getThinkingLevelForModelSwitch(this as unknown as AgentSessionModelTarget, explicitLevel);
	}

	private _clampThinkingLevel(level: ThinkingLevel, availableLevels: ThinkingLevel[]): ThinkingLevel {
		return clampThinkingLevel(level, availableLevels);
	}

	// =========================================================================
	// Queue Mode Management
	// =========================================================================

	/**
	 * Set steering message mode.
	 * Saves to settings.
	 */
	setSteeringMode(mode: "all" | "one-at-a-time"): void {
		this.agent.steeringMode = mode;
		this.settingsManager.setSteeringMode(mode);
	}

	/**
	 * Set follow-up message mode.
	 * Saves to settings.
	 */
	setFollowUpMode(mode: "all" | "one-at-a-time"): void {
		this.agent.followUpMode = mode;
		this.settingsManager.setFollowUpMode(mode);
	}

	// =========================================================================
	// Compaction
	// =========================================================================

	/**
	 * Manually compact the session context.
	 * Aborts current agent operation first.
	 * @param customInstructions Optional instructions for the compaction summary
	 */
	async compact(customInstructions?: string): Promise<CompactionResult> {
		return await compactSession(this as unknown as AgentSessionCompactionTarget, customInstructions);
	}

	/**
	 * Cancel in-progress compaction (manual or auto).
	 */
	abortCompaction(): void {
		this._compactionAbortController?.abort();
		this._autoCompactionAbortController?.abort();
	}

	/**
	 * Cancel in-progress branch summarization.
	 */
	abortBranchSummary(): void {
		this._branchSummaryAbortController?.abort();
	}

	/**
	 * Check if compaction is needed and run it.
	 * Called after agent_end and before prompt submission.
	 *
	 * Two cases:
	 * 1. Overflow: LLM returned context overflow error, remove error message from agent state, compact, auto-retry
	 * 2. Threshold: Context over threshold, compact, NO auto-retry (user continues manually)
	 *
	 * @param assistantMessage The assistant message to check
	 * @param skipAbortedCheck If false, include aborted messages (for pre-prompt check). Default: true
	 */
	private async _checkCompaction(assistantMessage: AssistantMessage, skipAbortedCheck = true): Promise<void> {
		await checkSessionCompaction(this as unknown as AgentSessionCompactionTarget, assistantMessage, skipAbortedCheck);
	}

	/**
	 * Internal: Run auto-compaction with events.
	 */
	private async _runAutoCompaction(reason: "overflow" | "threshold", willRetry: boolean): Promise<void> {
		await runAutoCompaction(this as unknown as AgentSessionCompactionTarget, reason, willRetry);
	}

	/**
	 * Toggle auto-compaction setting.
	 */
	setAutoCompactionEnabled(enabled: boolean): void {
		this.settingsManager.setCompactionEnabled(enabled);
	}

	/** Whether auto-compaction is enabled */
	get autoCompactionEnabled(): boolean {
		return this.settingsManager.getCompactionEnabled();
	}

	async bindExtensions(bindings: ExtensionBindings): Promise<void> {
		await bindSessionExtensions(this as unknown as AgentSessionReloadTarget, bindings);
	}

	private async extendResourcesFromExtensions(reason: "startup" | "reload"): Promise<void> {
		await extendResourcesFromExtensions(this as unknown as AgentSessionReloadTarget, reason);
	}

	private buildExtensionResourcePaths(entries: Array<{ path: string; extensionPath: string }>): Array<{
		path: string;
		metadata: { source: string; scope: "temporary"; origin: "top-level"; baseDir?: string };
	}> {
		return buildExtensionResourcePaths(entries);
	}

	private getExtensionSourceLabel(extensionPath: string): string {
		return getExtensionSourceLabel(extensionPath);
	}

	private _applyExtensionBindings(runner: ExtensionRunner): void {
		applyExtensionBindings(this as unknown as AgentSessionReloadTarget, runner);
	}

	private _refreshCurrentModelFromRegistry(): void {
		refreshCurrentModelFromRegistry(this as unknown as AgentSessionReloadTarget);
	}

	private _bindExtensionCore(runner: ExtensionRunner): void {
		bindExtensionCore(this as unknown as AgentSessionReloadTarget, runner);
	}

	private _refreshToolRegistry(options?: { activeToolNames?: string[]; includeAllExtensionTools?: boolean }): void {
		refreshToolRegistry(this as unknown as AgentSessionReloadTarget, options);
	}

	private _buildRuntime(options: {
		activeToolNames?: string[];
		flagValues?: Map<string, boolean | string>;
		includeAllExtensionTools?: boolean;
	}): void {
		buildRuntime(this as unknown as AgentSessionReloadTarget, options);
	}

	async reload(): Promise<void> {
		await reloadSession(this as unknown as AgentSessionReloadTarget);
	}

	// =========================================================================
	// Auto-Retry
	// =========================================================================

	/**
	 * Check if an error is retryable (overloaded, rate limit, server errors).
	 * Context overflow errors are NOT retryable (handled by compaction instead).
	 */
	private _isRetryableError(message: AssistantMessage): boolean {
		return isRetryableAssistantError(message, this.model?.contextWindow ?? 0);
	}

	/**
	 * Handle retryable errors with exponential backoff.
	 * @returns true if retry was initiated, false if max retries exceeded or disabled
	 */
	private async _handleRetryableError(message: AssistantMessage): Promise<boolean> {
		return handleRetryableError(this as unknown as AgentSessionEventTarget, message);
	}

	/**
	 * Cancel in-progress retry.
	 */
	abortRetry(): void {
		abortSessionRetry(this as unknown as AgentSessionEventTarget);
	}

	/**
	 * Wait for any in-progress retry to complete.
	 * Returns immediately if no retry is in progress.
	 */
	private async waitForRetry(): Promise<void> {
		await waitForSessionRetry(this as unknown as AgentSessionEventTarget);
	}

	/** Whether auto-retry is currently in progress */
	get isRetrying(): boolean {
		return this._retryPromise !== undefined;
	}

	/** Whether auto-retry is enabled */
	get autoRetryEnabled(): boolean {
		return this.settingsManager.getRetryEnabled();
	}

	/**
	 * Toggle auto-retry setting.
	 */
	setAutoRetryEnabled(enabled: boolean): void {
		this.settingsManager.setRetryEnabled(enabled);
	}

	// =========================================================================
	// Bash Execution
	// =========================================================================

	/**
	 * Execute a bash command.
	 * Adds result to agent context and session.
	 * @param command The bash command to execute
	 * @param onChunk Optional streaming callback for output
	 * @param options.excludeFromContext If true, command output won't be sent to LLM (!! prefix)
	 * @param options.operations Custom BashOperations for remote execution
	 */
	async executeBash(
		command: string,
		onChunk?: (chunk: string) => void,
		options?: { excludeFromContext?: boolean; operations?: BashOperations },
	): Promise<BashResult> {
		return await executeSessionBash(this as unknown as AgentSessionBashTarget, command, onChunk, options);
	}

	/**
	 * Record a bash execution result in session history.
	 * Used by executeBash and by extensions that handle bash execution themselves.
	 */
	recordBashResult(command: string, result: BashResult, options?: { excludeFromContext?: boolean }): void {
		recordSessionBashResult(this as unknown as AgentSessionBashTarget, command, result, options);
	}

	/**
	 * Cancel running bash command.
	 */
	abortBash(): void {
		this._bashAbortController?.abort();
	}

	/** Whether a bash command is currently running */
	get isBashRunning(): boolean {
		return this._bashAbortController !== undefined;
	}

	/** Whether there are pending bash messages waiting to be flushed */
	get hasPendingBashMessages(): boolean {
		return this._pendingBashMessages.length > 0;
	}

	/**
	 * Flush pending bash messages to agent state and session.
	 * Called after agent turn completes to maintain proper message ordering.
	 */
	private _flushPendingBashMessages(): void {
		flushPendingBashMessages(this as unknown as AgentSessionBashTarget);
	}

	// =========================================================================
	// Session Management
	// =========================================================================

	/**
	 * Set a display name for the current session.
	 */
	setSessionName(name: string): void {
		this.sessionManager.appendSessionInfo(name);
		this._emit({ type: "session_info_changed", name: this.sessionManager.getSessionName() });
	}

	// =========================================================================
	// Tree Navigation
	// =========================================================================

	/**
	 * Navigate to a different node in the session tree.
	 * Unlike fork() which creates a new session file, this stays in the same file.
	 *
	 * @param targetId The entry ID to navigate to
	 * @param options.summarize Whether user wants to summarize abandoned branch
	 * @param options.customInstructions Custom instructions for summarizer
	 * @param options.replaceInstructions If true, customInstructions replaces the default prompt
	 * @param options.label Label to attach to the branch summary entry
	 * @returns Result with editorText (if user message) and cancelled status
	 */
	async navigateTree(
		targetId: string,
		options: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string } = {},
	): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: BranchSummaryEntry }> {
		return await navigateSessionTree(this as unknown as AgentSessionTreeTarget, targetId, options);
	}

	/**
	 * Get all user messages from session for fork selector.
	 */
	getUserMessagesForForking(): Array<{ entryId: string; text: string }> {
		return getUserMessagesForSessionForking(this as unknown as AgentSessionTreeTarget);
	}

	private _extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
		return extractUserMessageText(content);
	}

	/**
	 * Get session statistics.
	 */
	getSessionStats(): SessionStats {
		return getSessionStatistics(this as unknown as AgentSessionExportTarget);
	}

	getContextUsage(): ContextUsage | undefined {
		return getSessionContextUsage(this as unknown as AgentSessionExportTarget);
	}

	/**
	 * Export session to HTML.
	 * @param outputPath Optional output path (defaults to session directory)
	 * @returns Path to exported file
	 */
	async exportToHtml(outputPath?: string): Promise<string> {
		return await exportSessionHtml(this as unknown as AgentSessionExportTarget, outputPath);
	}

	/**
	 * Export the current session branch to a JSONL file.
	 * Writes the session header followed by all entries on the current branch path.
	 * @param outputPath Target file path. If omitted, generates a timestamped file in cwd.
	 * @returns The resolved output file path.
	 */
	exportToJsonl(outputPath?: string): string {
		return exportSessionJsonl(this as unknown as AgentSessionExportTarget, outputPath);
	}

	// =========================================================================
	// Utilities
	// =========================================================================

	/**
	 * Get text content of last assistant message.
	 * Useful for /copy command.
	 * @returns Text content, or undefined if no assistant message exists
	 */
	getLastAssistantText(): string | undefined {
		return getLastAssistantText(this.messages);
	}

	// =========================================================================
	// Extension System
	// =========================================================================

	createReplacedSessionContext(): ReplacedSessionContext {
		const context = Object.defineProperties(
			{},
			Object.getOwnPropertyDescriptors(this._extensionRunner.createCommandContext()),
		) as ReplacedSessionContext;
		context.sendMessage = (message, options) => this.sendCustomMessage(message, options);
		context.sendUserMessage = (content, options) => this.sendUserMessage(content, options);
		return context;
	}

	/**
	 * Check if extensions have handlers for a specific event type.
	 */
	hasExtensionHandlers(eventType: string): boolean {
		return this._extensionRunner.hasHandlers(eventType);
	}

	/**
	 * Get the extension runner (for setting UI context and error handlers).
	 */
	get extensionRunner(): ExtensionRunner {
		return this._extensionRunner;
	}
}
