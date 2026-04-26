/**
 * Interactive cwd recovery for resumed sessions.
 *
 * Session files persist the workspace cwd they were created from. When that
 * directory is deleted or moved, interactive startup gives the user one safe
 * choice: continue from the current process cwd or cancel before runtime
 * services are created for the wrong project.
 */

import { ProcessTerminal, setKeybindings, TUI } from "@mariozechner/pi-tui";
import { KeybindingsManager } from "../../core/keybindings.js";
import { formatMissingSessionCwdPrompt, type SessionCwdIssue } from "../../core/session-cwd.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import { ExtensionSelectorComponent } from "../../modes/interactive/components/extension-selector.js";
import { initTheme } from "../../modes/interactive/theme/theme.js";

/**
 * Show the missing-cwd selector and return the fallback cwd only on consent.
 *
 * The caller owns process exit behavior. This function only creates the minimal
 * TUI needed for the prompt and always stops it before resolving.
 */
export async function promptForMissingSessionCwd(
	issue: SessionCwdIssue,
	settingsManager: SettingsManager,
): Promise<string | undefined> {
	initTheme(settingsManager.getTheme());
	setKeybindings(KeybindingsManager.create());

	return new Promise((resolve) => {
		const ui = new TUI(new ProcessTerminal(), settingsManager.getShowHardwareCursor());
		ui.setClearOnShrink(settingsManager.getClearOnShrink());

		let settled = false;
		const finish = (result: string | undefined) => {
			if (settled) {
				return;
			}
			settled = true;
			ui.stop();
			resolve(result);
		};

		const selector = new ExtensionSelectorComponent(
			formatMissingSessionCwdPrompt(issue),
			["Continue", "Cancel"],
			(option) => finish(option === "Continue" ? issue.fallbackCwd : undefined),
			() => finish(undefined),
			{ tui: ui },
		);
		ui.addChild(selector);
		ui.setFocus(selector);
		ui.start();
	});
}
