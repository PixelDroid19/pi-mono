/**
 * Barrel re-export for agent-session internal helpers.
 * Same-domain only — do not import from outside core/.
 */
export {
	type AgentSessionActiveToolTarget,
	getActiveToolNames,
	getAllTools,
	getToolDefinition,
	setActiveToolsByName,
} from "./active-tools.js";
export {
	type AgentSessionBashTarget,
	executeSessionBash,
	flushPendingBashMessages,
	recordSessionBashResult,
} from "./bash-execution.js";
export { getAssistantMessageText, isOverflowError, isRetryableError } from "./compaction-messages.js";
export {
	type AgentSessionCustomMessageTarget,
	sendSessionCustomMessage,
	sendSessionUserMessage,
} from "./custom-messages.js";
export { forwardAgentEventToExtensions } from "./event-bridge.js";
export {
	type AgentSessionLifecycleTarget,
	disconnectSessionAgent,
	disposeSession,
	emitSessionEvent,
	reconnectSessionAgent,
	subscribeToSessionEvents,
} from "./lifecycle.js";
export {
	type AgentSessionModelTarget,
	clampThinkingLevel,
	cycleSessionModel,
	cycleSessionThinkingLevel,
	emitModelSelect,
	getAvailableThinkingLevels,
	getThinkingLevelForModelSwitch,
	rebuildSessionSystemPrompt,
	setSessionModel,
	setSessionThinkingLevel,
	supportsSessionThinking,
	supportsSessionXhighThinking,
} from "./model-state.js";
export { expandPromptTemplatesInText, expandSkillCommand, parseExtensionCommand } from "./prompt-expansion.js";
export {
	type AgentSessionPromptTarget,
	expandSessionSkillCommand,
	followUpSession,
	promptSession,
	queueFollowUpMessage,
	queueSteeringMessage,
	steerSession,
	throwIfExtensionCommand,
	tryExecuteExtensionCommand,
} from "./prompt-queue.js";
export {
	type AgentSessionReloadTarget,
	applyExtensionBindings,
	bindExtensionCore,
	bindSessionExtensions,
	buildExtensionResourcePaths,
	buildRuntime,
	extendResourcesFromExtensions,
	getExtensionSourceLabel,
	getReloadableResources,
	type ReloadOptions,
	refreshCurrentModelFromRegistry,
	refreshToolRegistry,
	reloadSession,
} from "./reload.js";
export {
	type AgentSessionCompactionTarget,
	checkSessionCompaction,
	compactSession,
	runAutoCompaction,
} from "./session-compaction.js";
export {
	type AgentSessionEventTarget,
	abortRetry,
	createRetryPromiseForAgentEnd,
	emitExtensionEvent,
	findLastAssistantInMessages,
	findLastAssistantMessage,
	getUserMessageText,
	handleRetryableError,
	isRetryableAssistantError,
	processAgentEvent,
	resolveRetry,
	waitForRetry,
} from "./session-events.js";
export {
	type AgentSessionExportTarget,
	exportSessionHtml,
	exportSessionJsonl,
	getLastAssistantText,
	getSessionContextUsage,
	getSessionStats,
} from "./session-export.js";
export { type AgentSessionToolHookTarget, installAgentToolHooks } from "./tool-hooks.js";
export {
	buildSystemPromptFromTools,
	filterActiveTools,
	normalizePromptGuidelines,
	normalizePromptSnippet,
	type ToolDefinitionEntry,
} from "./tool-registry.js";
export {
	type AgentSessionTreeTarget,
	extractUserMessageText,
	getUserMessagesForSessionForking,
	type NavigateTreeOptions,
	type NavigateTreeResult,
	navigateSessionTree,
} from "./tree-navigation.js";
