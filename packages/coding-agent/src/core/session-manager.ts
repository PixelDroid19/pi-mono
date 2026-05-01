/**
 * Public session-manager facade.
 *
 * Session records, migrations, context building, listing, and persistence live
 * under session-manager-internal. This file preserves the historical import
 * path for SDK and package-internal consumers.
 */

import type { SessionManager } from "./session-manager-internal/session-manager.js";

export type {
	BranchSummaryEntry,
	CompactionEntry,
	CustomEntry,
	CustomMessageEntry,
	FileEntry,
	LabelEntry,
	ModelChangeEntry,
	NewSessionOptions,
	SessionContext,
	SessionEntry,
	SessionEntryBase,
	SessionHeader,
	SessionInfo,
	SessionInfoEntry,
	SessionListProgress,
	SessionMessageEntry,
	SessionTreeNode,
	ThinkingLevelChangeEntry,
} from "./session-manager-internal/records.js";
export {
	buildSessionContext,
	CURRENT_SESSION_VERSION,
	findMostRecentSession,
	getDefaultSessionDir,
	getLatestCompactionEntry,
	loadEntriesFromFile,
	migrateSessionEntries,
	parseSessionEntries,
} from "./session-manager-internal/records.js";
export { SessionManager } from "./session-manager-internal/session-manager.js";

export type ReadonlySessionManager = Pick<
	SessionManager,
	| "getCwd"
	| "getSessionDir"
	| "getSessionId"
	| "getSessionFile"
	| "getLeafId"
	| "getLeafEntry"
	| "getEntry"
	| "getLabel"
	| "getBranch"
	| "getHeader"
	| "getEntries"
	| "getTree"
	| "getSessionName"
>;
