/**
 * Session action helpers extracted from InteractiveMode.
 *
 * Handles import, tree navigation, fork flows, and session management actions.
 * These preserve existing keybinding IDs and emitted events.
 */

import type { SettingsManager } from "../../../core/settings-manager.js";

/**
 * Check if a tmux session has proper extended-keys configuration.
 * Returns a warning string if misconfigured, undefined if OK or not in tmux.
 */
export async function checkTmuxKeyboardSetup(): Promise<string | undefined> {
	if (!process.env.TMUX) return undefined;

	const { spawn } = await import("child_process");

	const runTmuxShow = (option: string): Promise<string | undefined> => {
		return new Promise((resolve) => {
			const proc = spawn("tmux", ["show", "-gv", option], {
				stdio: ["ignore", "pipe", "ignore"],
			});
			let stdout = "";
			const timer = setTimeout(() => {
				proc.kill();
				resolve(undefined);
			}, 2000);

			proc.stdout?.on("data", (data: Buffer) => {
				stdout += data.toString();
			});
			proc.on("error", () => {
				clearTimeout(timer);
				resolve(undefined);
			});
			proc.on("close", (code: number | null) => {
				clearTimeout(timer);
				resolve(code === 0 ? stdout.trim() : undefined);
			});
		});
	};

	const [extendedKeys, extendedKeysFormat] = await Promise.all([
		runTmuxShow("extended-keys"),
		runTmuxShow("extended-keys-format"),
	]);

	if (extendedKeys === undefined) return undefined;

	if (extendedKeys !== "on" && extendedKeys !== "always") {
		return "tmux extended-keys is off. Modified Enter keys may not work. Add `set -g extended-keys on` to ~/.tmux.conf and restart tmux.";
	}

	if (extendedKeysFormat === "xterm") {
		return "tmux extended-keys-format is xterm. Pi works best with csi-u. Add `set -g extended-keys-format csi-u` to ~/.tmux.conf and restart tmux.";
	}

	return undefined;
}

/**
 * Check for available package updates.
 */
export async function checkForPackageUpdates(
	cwd: string,
	agentDir: string,
	settingsManager: SettingsManager,
): Promise<string[]> {
	if (process.env.PI_OFFLINE) {
		return [];
	}

	try {
		const { DefaultPackageManager } = await import("../../../core/package-manager.js");
		const packageManager = new DefaultPackageManager({
			cwd,
			agentDir,
			settingsManager,
		});
		const updates = await packageManager.checkForAvailableUpdates();
		return updates.map((update) => update.displayName);
	} catch {
		return [];
	}
}
