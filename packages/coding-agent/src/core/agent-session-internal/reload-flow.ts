/**
 * Session reload flow helpers extracted from AgentSession.
 *
 * Handles the reload command which re-initializes resources, extensions,
 * and tool definitions without losing session state.
 */

/**
 * Options for a session reload operation.
 */
export interface ReloadOptions {
	/** Whether to preserve the current extension runner state */
	preserveExtensions?: boolean;
	/** Additional paths to reload */
	additionalPaths?: string[];
}

/**
 * Determine which resources need refreshing during a reload.
 * Returns a list of resource categories that should be reloaded.
 */
export function getReloadableResources(): string[] {
	return ["extensions", "skills", "promptTemplates", "themes", "contextFiles", "systemPrompt"];
}
