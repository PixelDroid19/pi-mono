/**
 * Lower-section command presentation for InteractiveMode.
 *
 * These helpers cover visual slash commands and easter-egg renderers that do
 * not need to own session orchestration. They are intentionally small and are
 * designed to be called by one-line wrappers in InteractiveMode.
 */

import type { Keybinding, MarkdownTheme, TUI } from "@mariozechner/pi-tui";
import { type Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { AppKeybinding, KeybindingsManager } from "../../../core/keybindings.js";
import { ArminComponent } from "../components/armin.js";
import { DaxnutsComponent } from "../components/daxnuts.js";
import { DynamicBorder } from "../components/dynamic-border.js";
import { EarendilAnnouncementComponent } from "../components/earendil-announcement.js";
import { theme } from "../theme/theme.js";
import { formatHotkeysMarkdown } from "./hotkeys.js";

export interface LowerCommandActionsTarget {
	chatContainer: Container;
	keybindings: KeybindingsManager;
	session: AgentSession;
	ui: TUI;
	getAppKeyDisplay(action: AppKeybinding): string;
	getEditorKeyDisplay(action: Keybinding): string;
	getMarkdownThemeWithSettings(): MarkdownTheme;
}

/** Render the `/hotkeys` reference using current app, editor, and extension keybindings. */
export function handleHotkeysCommand(target: LowerCommandActionsTarget, platform: NodeJS.Platform): void {
	const shortcuts = Array.from(
		target.session.extensionRunner.getShortcuts(target.keybindings.getEffectiveConfig()),
		([key, shortcut]) => ({
			description: shortcut.description ?? shortcut.extensionPath,
			key,
		}),
	);
	const hotkeys = formatHotkeysMarkdown({
		appKey: (action) => target.getAppKeyDisplay(action),
		editorKey: (action) => target.getEditorKeyDisplay(action),
		extensionShortcuts: shortcuts,
		platform,
	});

	target.chatContainer.addChild(new Spacer(1));
	target.chatContainer.addChild(new DynamicBorder());
	target.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "Keyboard Shortcuts")), 1, 0));
	target.chatContainer.addChild(new Spacer(1));
	target.chatContainer.addChild(new Markdown(hotkeys, 1, 1, target.getMarkdownThemeWithSettings()));
	target.chatContainer.addChild(new DynamicBorder());
	target.ui.requestRender();
}

/** Render the Armin easter egg without requiring InteractiveMode to import the component directly. */
export function handleArminSaysHi(target: Pick<LowerCommandActionsTarget, "chatContainer" | "ui">): void {
	target.chatContainer.addChild(new Spacer(1));
	target.chatContainer.addChild(new ArminComponent(target.ui));
	target.ui.requestRender();
}

/** Render the Earendil announcement easter egg. */
export function handleDementedDelves(target: Pick<LowerCommandActionsTarget, "chatContainer" | "ui">): void {
	target.chatContainer.addChild(new Spacer(1));
	target.chatContainer.addChild(new EarendilAnnouncementComponent());
	target.ui.requestRender();
}

/** Render the Daxnuts easter egg. */
export function handleDaxnuts(target: Pick<LowerCommandActionsTarget, "chatContainer" | "ui">): void {
	target.chatContainer.addChild(new Spacer(1));
	target.chatContainer.addChild(new DaxnutsComponent(target.ui));
	target.ui.requestRender();
}

/** Trigger the Daxnuts renderer for the model-specific easter egg. */
export function checkDaxnutsEasterEgg(
	target: Pick<LowerCommandActionsTarget, "chatContainer" | "ui">,
	model: { provider: string; id: string },
): void {
	if (model.provider === "opencode" && model.id.toLowerCase().includes("kimi-k2.5")) {
		handleDaxnuts(target);
	}
}
