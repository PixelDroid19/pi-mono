/**
 * Barrel re-export for interactive mode internal helpers.
 * Same-domain only — do not import from outside modes/interactive/.
 */
export {
	type AuthDialogTarget,
	completeProviderAuthentication,
	showApiKeyLoginDialog,
	showBedrockSetupDialog,
	showLoginDialog,
} from "./auth-dialog-controller.js";
export {
	type AuthSelectorTarget,
	getApiKeyProviderDisplayName,
	isApiKeyLoginProvider,
	showOAuthSelector,
} from "./auth-selector-controller.js";
export { handleBashCommand, type InteractiveBashCommandTarget } from "./bash-command.js";
export {
	checkForNewVersion,
	getChangelogForDisplay,
	reportInstallTelemetry,
} from "./bootstrap.js";
export {
	type InteractiveCommandContext,
	isTruthyEnvFlag,
	isUnknownModel,
	parsePathCommandArgument,
	parseSlashCommand,
} from "./commands.js";
export { disposeWidget, renderWidgetContainer } from "./extension-ui.js";
export { formatHotkeysMarkdown } from "./hotkeys.js";
export {
	handleClipboardImagePaste,
	type KeyHandlerTarget,
	setupKeyHandlers,
} from "./key-handler-controller.js";
export {
	type LoadedResourcesHost,
	type ShowLoadedResourcesOptions,
	showLoadedResources,
} from "./loaded-resources.js";
export {
	type ModelSelectorTarget,
	showModelSelector,
	showModelsSelector,
} from "./model-selector-controller.js";
export {
	type NavigationSelectorTarget,
	showTreeSelector,
	showUserMessageSelector,
} from "./navigation-selector-controller.js";
export { handleReloadCommand, type ReloadCommandTarget } from "./reload-command.js";
export {
	formatContextPath,
	formatDisplayPath,
	getAutocompleteSourceTag,
	getDisplaySourceInfo,
	getScopeGroup,
	getShortPath,
	isPackageSource,
} from "./resource-display.js";
export { checkForPackageUpdates, checkTmuxKeyboardSetup } from "./session-actions.js";
export {
	handleChangelogCommand,
	handleClearCommand,
	handleCompactCommand,
	handleCopyCommand,
	handleDebugCommand,
	handleExportCommand,
	handleImportCommand,
	handleNameCommand,
	handleSessionCommand,
	type SessionCommandTarget,
} from "./session-command-handlers.js";
export { handleInteractiveEvent, type InteractiveEventTarget } from "./session-event-renderer.js";
export { formatSessionInfo } from "./session-info.js";
export {
	type CompactionQueuedMessage,
	clearAllQueuedMessages,
	flushCompactionQueuedMessages,
	getAllQueuedMessages,
	isExtensionCommandText,
} from "./session-queue.js";
export { type SessionSelectorTarget, showSessionSelector } from "./session-selector-controller.js";
export { type SettingsSelectorTarget, showSettingsSelector } from "./settings-selector-controller.js";
export { handleShareCommand, type InteractiveShareCommandTarget } from "./share-command.js";
export {
	handleSkillsCommand,
	type SkillSelectorTarget,
	showSkillSelector,
} from "./skill-selector-controller.js";
export { handleEditorSubmit, type InteractiveSubmitTarget } from "./submit-handler.js";
