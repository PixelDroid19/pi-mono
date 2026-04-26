/**
 * Submit dispatcher for InteractiveMode editor input.
 *
 * The interactive screen owns rendering and editor state, while this module owns
 * the ordered command decisions that run after the user submits text. Keeping
 * this dispatch outside the component prevents slash commands, bash shortcuts,
 * queueing rules, and normal prompt submission from growing inside the UI class.
 */

import type { AgentSession } from "../../../core/agent-session.js";
import { showOAuthSelector as _showOAuthSelector, type AuthSelectorTarget } from "./auth-selector-controller.js";
import {
	handleArminSaysHi as _handleArminSaysHi,
	handleDementedDelves as _handleDementedDelves,
	handleHotkeysCommand as _handleHotkeysCommand,
	type LowerCommandActionsTarget,
} from "./lower-command-actions.js";
import { handleModelCommand as _handleModelCommand, type ModelAuthActionsTarget } from "./model-auth-actions.js";
import { showModelsSelector as _showModelsSelector, type ModelSelectorTarget } from "./model-selector-controller.js";
import {
	showTreeSelector as _showTreeSelector,
	showUserMessageSelector as _showUserMessageSelector,
	type NavigationSelectorTarget,
} from "./navigation-selector-controller.js";
import { handleReloadCommand as _handleReloadCommand, type ReloadCommandTarget } from "./reload-command.js";
import {
	handleChangelogCommand as _handleChangelogCommand,
	handleClearCommand as _handleClearCommand,
	handleCompactCommand as _handleCompactCommand,
	handleCopyCommand as _handleCopyCommand,
	handleDebugCommand as _handleDebugCommand,
	handleExportCommand as _handleExportCommand,
	handleImportCommand as _handleImportCommand,
	handleNameCommand as _handleNameCommand,
	handleSessionCommand as _handleSessionCommand,
	type SessionCommandTarget,
} from "./session-command-handlers.js";
import {
	updatePendingMessagesDisplay as _updatePendingMessagesDisplay,
	type SessionFeedbackTarget,
} from "./session-feedback-controller.js";
import { handleCloneCommand as _handleCloneCommand, type SessionRuntimeTarget } from "./session-runtime-controller.js";
import {
	showSessionSelector as _showSessionSelector,
	type SessionSelectorTarget,
} from "./session-selector-controller.js";
import {
	showSettingsSelector as _showSettingsSelector,
	type SettingsSelectorTarget,
} from "./settings-selector-controller.js";
import { handleShareCommand as _handleShareCommand, type InteractiveShareCommandTarget } from "./share-command.js";
import { handleSkillsCommand as _handleSkillsCommand, type SkillSelectorTarget } from "./skill-selector-controller.js";

interface SubmitEditor {
	addToHistory?(text: string): void;
	setText(text: string): void;
}

interface SubmitRenderer {
	requestRender(): void;
}

/**
 * Minimal InteractiveMode surface required by editor submit dispatch.
 *
 * The contract is intentionally expressed in callbacks and mutable session flags
 * instead of depending on the full class. That keeps the submit handler isolated
 * from rendering internals while preserving the command ordering and state
 * transitions from InteractiveMode.
 */
export interface InteractiveSubmitTarget {
	session: AgentSession;
	editor: SubmitEditor;
	isBashMode: boolean;
	onInputCallback?: (text: string) => void;
	ui: SubmitRenderer;
	flushPendingBashComponents(): void;
	handleBashCommand(command: string, excludeFromContext?: boolean): Promise<void>;
	isExtensionCommand(text: string): boolean;
	queueCompactionMessage(text: string, mode: "steer" | "followUp"): void;
	showWarning(message: string): void;
	shutdown(): Promise<void>;
	updateEditorBorderColor(): void;
}

/** Dispatch a submitted editor value to the matching interactive action. */
export async function handleEditorSubmit(target: InteractiveSubmitTarget, text: string): Promise<void> {
	text = text.trim();
	if (!text) return;

	// Handle commands
	if (text === "/settings") {
		_showSettingsSelector(target as unknown as SettingsSelectorTarget);
		target.editor.setText("");
		return;
	}
	if (text === "/scoped-models") {
		target.editor.setText("");
		await _showModelsSelector(target as unknown as ModelSelectorTarget);
		return;
	}
	if (text === "/model" || text.startsWith("/model ")) {
		const searchTerm = text.startsWith("/model ") ? text.slice(7).trim() : undefined;
		target.editor.setText("");
		await _handleModelCommand(target as unknown as ModelAuthActionsTarget, searchTerm);
		return;
	}
	if (text === "/export" || text.startsWith("/export ")) {
		await _handleExportCommand(target as unknown as SessionCommandTarget, text);
		target.editor.setText("");
		return;
	}
	if (text === "/import" || text.startsWith("/import ")) {
		await _handleImportCommand(target as unknown as SessionCommandTarget, text);
		target.editor.setText("");
		return;
	}
	if (text === "/share") {
		await _handleShareCommand(target as unknown as InteractiveShareCommandTarget);
		target.editor.setText("");
		return;
	}
	if (text === "/copy") {
		await _handleCopyCommand(target as unknown as SessionCommandTarget);
		target.editor.setText("");
		return;
	}
	if (text === "/name" || text.startsWith("/name ")) {
		_handleNameCommand(target as unknown as SessionCommandTarget, text);
		target.editor.setText("");
		return;
	}
	if (text === "/session") {
		_handleSessionCommand(target as unknown as SessionCommandTarget);
		target.editor.setText("");
		return;
	}
	if (text === "/changelog") {
		_handleChangelogCommand(target as unknown as SessionCommandTarget);
		target.editor.setText("");
		return;
	}
	if (text === "/hotkeys") {
		_handleHotkeysCommand(target as unknown as LowerCommandActionsTarget, process.platform);
		target.editor.setText("");
		return;
	}
	if (text === "/fork") {
		_showUserMessageSelector(target as unknown as NavigationSelectorTarget);
		target.editor.setText("");
		return;
	}
	if (text === "/clone") {
		target.editor.setText("");
		await _handleCloneCommand(target as unknown as SessionRuntimeTarget);
		return;
	}
	if (text === "/tree") {
		_showTreeSelector(target as unknown as NavigationSelectorTarget);
		target.editor.setText("");
		return;
	}
	if (text === "/login") {
		await _showOAuthSelector(target as unknown as AuthSelectorTarget, "login");
		target.editor.setText("");
		return;
	}
	if (text === "/logout") {
		await _showOAuthSelector(target as unknown as AuthSelectorTarget, "logout");
		target.editor.setText("");
		return;
	}
	if (text === "/new") {
		target.editor.setText("");
		await _handleClearCommand(target as unknown as SessionCommandTarget);
		return;
	}
	if (text === "/compact" || text.startsWith("/compact ")) {
		const customInstructions = text.startsWith("/compact ") ? text.slice(9).trim() : undefined;
		target.editor.setText("");
		await _handleCompactCommand(target as unknown as SessionCommandTarget, customInstructions);
		return;
	}
	if (text === "/reload") {
		target.editor.setText("");
		await _handleReloadCommand(target as unknown as ReloadCommandTarget);
		return;
	}
	if (text === "/skills" || text.startsWith("/skills ")) {
		const searchTerm = text.startsWith("/skills ") ? text.slice(8).trim() : undefined;
		target.editor.setText("");
		await _handleSkillsCommand(target as unknown as SkillSelectorTarget, searchTerm);
		return;
	}
	if (text === "/debug") {
		_handleDebugCommand(target as unknown as SessionCommandTarget);
		target.editor.setText("");
		return;
	}
	if (text === "/arminsayshi") {
		_handleArminSaysHi(target as unknown as LowerCommandActionsTarget);
		target.editor.setText("");
		return;
	}
	if (text === "/dementedelves") {
		_handleDementedDelves(target as unknown as LowerCommandActionsTarget);
		target.editor.setText("");
		return;
	}
	if (text === "/resume") {
		_showSessionSelector(target as unknown as SessionSelectorTarget);
		target.editor.setText("");
		return;
	}
	if (text === "/quit") {
		target.editor.setText("");
		await target.shutdown();
		return;
	}

	// Handle bash command (! for normal, !! for excluded from context)
	if (text.startsWith("!")) {
		const isExcluded = text.startsWith("!!");
		const command = isExcluded ? text.slice(2).trim() : text.slice(1).trim();
		if (command) {
			if (target.session.isBashRunning) {
				target.showWarning("A bash command is already running. Press Esc to cancel it first.");
				target.editor.setText(text);
				return;
			}
			target.editor.addToHistory?.(text);
			await target.handleBashCommand(command, isExcluded);
			target.isBashMode = false;
			target.updateEditorBorderColor();
			return;
		}
	}

	// Queue input during compaction (extension commands execute immediately)
	if (target.session.isCompacting) {
		if (target.isExtensionCommand(text)) {
			target.editor.addToHistory?.(text);
			target.editor.setText("");
			await target.session.prompt(text);
		} else {
			target.queueCompactionMessage(text, "steer");
		}
		return;
	}

	// If streaming, use prompt() with steer behavior
	// This handles extension commands (execute immediately), prompt template expansion, and queueing
	if (target.session.isStreaming) {
		target.editor.addToHistory?.(text);
		target.editor.setText("");
		await target.session.prompt(text, { streamingBehavior: "steer" });
		_updatePendingMessagesDisplay(target as unknown as SessionFeedbackTarget);
		target.ui.requestRender();
		return;
	}

	// Normal message submission
	// First, move any pending bash components to chat
	target.flushPendingBashComponents();

	if (target.onInputCallback) {
		target.onInputCallback(text);
	}
	target.editor.addToHistory?.(text);
}
