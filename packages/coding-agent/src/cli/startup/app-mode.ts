/**
 * App mode resolution helpers extracted from main.ts.
 *
 * Determines the runtime mode (interactive, print, json, rpc) based on
 * CLI arguments and environment state.
 */

import type { Args, Mode } from "../args.js";

export type AppMode = "interactive" | "print" | "json" | "rpc";

/**
 * Resolve the application mode from parsed CLI args and stdin state.
 */
export function resolveAppMode(parsed: Args, stdinIsTTY: boolean): AppMode {
	if (parsed.mode === "rpc") {
		return "rpc";
	}
	if (parsed.mode === "json") {
		return "json";
	}
	if (parsed.print || !stdinIsTTY) {
		return "print";
	}
	return "interactive";
}

/**
 * Map an AppMode to the output mode used by print-mode runners.
 */
export function toPrintOutputMode(appMode: AppMode): Exclude<Mode, "rpc"> {
	return appMode === "json" ? "json" : "text";
}

/**
 * Check whether an environment variable value is a truthy flag.
 */
export function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}
