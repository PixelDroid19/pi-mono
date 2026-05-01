import type { ImageContent } from "@mariozechner/pi-ai";

/**
 * Startup contract for the interactive TUI.
 *
 * These values are fixed when the CLI creates the interactive mode and are
 * consumed during initialization to restore model state, replay startup input,
 * and decide how much resource information should be rendered before the first
 * prompt. The object is intentionally immutable from the user's perspective;
 * later runtime changes are handled through AgentSession and settings managers.
 */
export interface InteractiveModeOptions {
	/** Providers that were migrated to auth.json and should be surfaced once. */
	migratedProviders?: string[];
	/** Warning shown when persisted session model state could not be restored. */
	modelFallbackMessage?: string;
	/** Initial prompt submitted after startup resource loading completes. */
	initialMessage?: string;
	/** Images attached to the initial startup prompt. */
	initialImages?: ImageContent[];
	/** Additional startup prompts submitted after the initial message. */
	initialMessages?: string[];
	/** Forces expanded startup diagnostics regardless of persisted quiet settings. */
	verbose?: boolean;
}
