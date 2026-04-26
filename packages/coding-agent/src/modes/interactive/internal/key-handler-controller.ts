/**
 * Keyboard and clipboard-image handlers for InteractiveMode.
 *
 * The editor component owns raw key dispatch. This controller maps configured
 * app actions to session/UI operations and keeps bash-mode detection plus
 * clipboard image insertion outside the main interactive class.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { EditorComponent, TUI } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { SettingsManager } from "../../../core/settings-manager.js";
import { extensionForImageMimeType, readClipboardImage } from "../../../utils/clipboard-image.js";
import type { CustomEditor } from "../components/custom-editor.js";
import { showModelSelector as _showModelSelector, type ModelSelectorTarget } from "./model-selector-controller.js";
import {
	showTreeSelector as _showTreeSelector,
	showUserMessageSelector as _showUserMessageSelector,
	type NavigationSelectorTarget,
} from "./navigation-selector-controller.js";
import {
	handleClearCommand as _handleClearCommand,
	handleDebugCommand as _handleDebugCommand,
	type SessionCommandTarget,
} from "./session-command-handlers.js";
import {
	showSessionSelector as _showSessionSelector,
	type SessionSelectorTarget,
} from "./session-selector-controller.js";

export interface KeyHandlerTarget {
	defaultEditor: CustomEditor;
	editor: EditorComponent;
	isBashMode: boolean;
	lastEscapeTime: number;
	session: AgentSession;
	settingsManager: SettingsManager;
	ui: TUI;
	cycleModel(direction: "forward" | "backward"): Promise<void>;
	cycleThinkingLevel(): void;
	handleCtrlC(): void;
	handleCtrlD(): void;
	handleCtrlZ(): void;
	handleDequeue(): void;
	handleFollowUp(): Promise<void>;
	openExternalEditor(): void;
	restoreQueuedMessagesToEditor(options?: { abort?: boolean; currentText?: string }): number;
	toggleThinkingBlockVisibility(): void;
	toggleToolOutputExpansion(): void;
	updateEditorBorderColor(): void;
}

/** Register configured app actions and editor state handlers on the default editor. */
export function setupKeyHandlers(target: KeyHandlerTarget): void {
	target.defaultEditor.onEscape = () => {
		if (target.session.isStreaming) {
			target.restoreQueuedMessagesToEditor({ abort: true });
		} else if (target.session.isBashRunning) {
			target.session.abortBash();
		} else if (target.isBashMode) {
			target.editor.setText("");
			target.isBashMode = false;
			target.updateEditorBorderColor();
		} else if (!target.editor.getText().trim()) {
			const action = target.settingsManager.getDoubleEscapeAction();
			if (action !== "none") {
				const now = Date.now();
				if (now - target.lastEscapeTime < 500) {
					if (action === "tree") {
						_showTreeSelector(target as unknown as NavigationSelectorTarget);
					} else {
						_showUserMessageSelector(target as unknown as NavigationSelectorTarget);
					}
					target.lastEscapeTime = 0;
				} else {
					target.lastEscapeTime = now;
				}
			}
		}
	};

	target.defaultEditor.onAction("app.clear", () => target.handleCtrlC());
	target.defaultEditor.onCtrlD = () => target.handleCtrlD();
	target.defaultEditor.onAction("app.suspend", () => target.handleCtrlZ());
	target.defaultEditor.onAction("app.thinking.cycle", () => target.cycleThinkingLevel());
	target.defaultEditor.onAction("app.model.cycleForward", () => target.cycleModel("forward"));
	target.defaultEditor.onAction("app.model.cycleBackward", () => target.cycleModel("backward"));
	target.ui.onDebug = () => _handleDebugCommand(target as unknown as SessionCommandTarget);
	target.defaultEditor.onAction("app.model.select", () =>
		_showModelSelector(target as unknown as ModelSelectorTarget),
	);
	target.defaultEditor.onAction("app.tools.expand", () => target.toggleToolOutputExpansion());
	target.defaultEditor.onAction("app.thinking.toggle", () => target.toggleThinkingBlockVisibility());
	target.defaultEditor.onAction("app.editor.external", () => target.openExternalEditor());
	target.defaultEditor.onAction("app.message.followUp", () => target.handleFollowUp());
	target.defaultEditor.onAction("app.message.dequeue", () => target.handleDequeue());
	target.defaultEditor.onAction("app.session.new", () =>
		_handleClearCommand(target as unknown as SessionCommandTarget),
	);
	target.defaultEditor.onAction("app.session.tree", () =>
		_showTreeSelector(target as unknown as NavigationSelectorTarget),
	);
	target.defaultEditor.onAction("app.session.fork", () =>
		_showUserMessageSelector(target as unknown as NavigationSelectorTarget),
	);
	target.defaultEditor.onAction("app.session.resume", () =>
		_showSessionSelector(target as unknown as SessionSelectorTarget),
	);

	target.defaultEditor.onChange = (text: string) => {
		const wasBashMode = target.isBashMode;
		target.isBashMode = text.trimStart().startsWith("!");
		if (wasBashMode !== target.isBashMode) {
			target.updateEditorBorderColor();
		}
	};

	target.defaultEditor.onPasteImage = () => {
		void handleClipboardImagePaste(target);
	};
}

/** Read an image from the clipboard, persist it to a temp file, and insert its path. */
export async function handleClipboardImagePaste(target: KeyHandlerTarget): Promise<void> {
	try {
		const image = await readClipboardImage();
		if (!image) {
			return;
		}

		const tmpDir = os.tmpdir();
		const ext = extensionForImageMimeType(image.mimeType) ?? "png";
		const fileName = `pi-clipboard-${crypto.randomUUID()}.${ext}`;
		const filePath = path.join(tmpDir, fileName);
		fs.writeFileSync(filePath, Buffer.from(image.bytes));

		target.editor.insertTextAtCursor?.(filePath);
		target.ui.requestRender();
	} catch {
		// Clipboard access can fail depending on terminal/OS permissions.
	}
}
