/**
 * CLI startup helpers barrel.
 *
 * Internal-only -- not re-exported from any public barrel.
 * Only re-exports from this folder.
 */

export { type AppMode, isTruthyEnvFlag, resolveAppMode, toPrintOutputMode } from "./app-mode.js";
export { resolveCliPaths } from "./cli-paths.js";
export { prepareInitialMessage, readPipedStdin } from "./initial-message.js";
export { promptForMissingSessionCwd } from "./missing-session-cwd.js";
export {
	buildSessionOptions,
	collectSettingsDiagnostics,
	reportDiagnostics,
} from "./runtime-bootstrap.js";
export { createMainRuntimeFactory, type MainRuntimeFactoryOptions } from "./runtime-factory.js";
export {
	createSessionManager,
	promptConfirm,
	type ResolvedSession,
	resolveSessionPath,
	validateForkFlags,
} from "./session-resolution.js";
