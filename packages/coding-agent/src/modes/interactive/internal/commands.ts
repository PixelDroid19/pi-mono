/**
 * Slash-command dispatch and model/session command helpers
 * extracted from InteractiveMode.
 *
 * These helpers work through narrow context objects rather than
 * direct access to the full InteractiveMode class.
 */

import type { TUI } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { SettingsManager } from "../../../core/settings-manager.js";

/**
 * Narrow context for slash-command handlers.
 * Provides only the dependencies a command handler needs.
 */
export interface InteractiveCommandContext {
	session: AgentSession;
	settingsManager: SettingsManager;
	ui: TUI;
	cwd: string;
}

/**
 * Parse a slash-command string into command name and arguments.
 * Returns undefined if the text is not a slash command.
 */
export function parseSlashCommand(text: string): { name: string; args: string } | undefined {
	if (!text.startsWith("/")) return undefined;
	const spaceIndex = text.indexOf(" ");
	if (spaceIndex === -1) {
		return { name: text.slice(1), args: "" };
	}
	return { name: text.slice(1, spaceIndex), args: text.slice(spaceIndex + 1).trim() };
}

/**
 * Check if a model provider is "unknown" (placeholder for missing auth).
 */
export function isUnknownModel(model: { provider: string; id: string; api: string } | undefined): boolean {
	return !!model && model.provider === "unknown" && model.id === "unknown" && model.api === "unknown";
}

/**
 * Check if an environment variable value is a truthy flag.
 */
export function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

/**
 * Extracts the optional path argument from path-based slash commands.
 *
 * The parser preserves quoted paths with spaces and returns undefined when the
 * submitted command should use its default destination. It is shared by import
 * and export handlers so both commands handle shell-style quoting consistently.
 */
export function parsePathCommandArgument(text: string, command: "/export" | "/import"): string | undefined {
	const trimmed = text.trim();
	if (trimmed === command) {
		return undefined;
	}

	if (!trimmed.startsWith(`${command} `)) {
		return undefined;
	}

	const raw = trimmed.slice(command.length).trim();
	if (!raw) {
		return undefined;
	}

	const isQuoted =
		(raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
		(raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2);
	return isQuoted ? raw.slice(1, -1) : raw;
}
