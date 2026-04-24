/**
 * Barrel re-export for interactive mode internal helpers.
 * Same-domain only — do not import from outside modes/interactive/.
 */
export {
	checkForNewVersion,
	getChangelogForDisplay,
	reportInstallTelemetry,
} from "./bootstrap.js";
export { type InteractiveCommandContext, isTruthyEnvFlag, isUnknownModel, parseSlashCommand } from "./commands.js";
export { disposeWidget, renderWidgetContainer } from "./extension-ui.js";
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
