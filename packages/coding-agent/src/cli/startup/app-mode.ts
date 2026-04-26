/**
 * CLI mode selection policy.
 *
 * `main.ts` uses this boundary before stdout is guarded or stdin is consumed.
 * The priority order is intentional: explicit RPC/JSON modes win, `--print` or
 * piped stdin force print mode, and only an attached TTY falls back to the
 * interactive TUI.
 */

import type { Args, Mode } from "../args.js";

export type AppMode = "interactive" | "print" | "json" | "rpc";

/**
 * Resolve the observable CLI mode from parsed flags and stdin availability.
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
 * Convert app-level modes to the narrower print-mode output contract.
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
