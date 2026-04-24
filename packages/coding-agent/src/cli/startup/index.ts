/**
 * CLI startup helpers barrel.
 *
 * Internal-only -- not re-exported from any public barrel.
 * Only re-exports from this folder.
 */

export { type AppMode, isTruthyEnvFlag, resolveAppMode, toPrintOutputMode } from "./app-mode.js";
export { prepareInitialMessage, readPipedStdin } from "./initial-message.js";
export {
	buildSessionOptions,
	collectSettingsDiagnostics,
	reportDiagnostics,
} from "./runtime-bootstrap.js";
export {
	createSessionManager,
	promptConfirm,
	type ResolvedSession,
	resolveSessionPath,
	validateForkFlags,
} from "./session-resolution.js";
