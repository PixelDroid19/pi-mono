/**
 * Submit dispatcher for InteractiveMode editor input.
 *
 * The interactive screen owns rendering and editor state, while this module owns
 * the ordered command decisions that run after the user submits text. Keeping
 * this dispatch outside the component prevents slash commands, bash shortcuts,
 * queueing rules, and normal prompt submission from growing inside the UI class.
 */

import type { AgentSession } from "../../../core/agent-session.js";

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
	handleArminSaysHi(): void;
	handleBashCommand(command: string, excludeFromContext?: boolean): Promise<void>;
	handleChangelogCommand(): void;
	handleClearCommand(): Promise<void>;
	handleCloneCommand(): Promise<void>;
	handleCompactCommand(customInstructions?: string): Promise<void>;
	handleCopyCommand(): Promise<void>;
	handleDebugCommand(): void;
	handleDementedDelves(): void;
	handleExportCommand(text: string): Promise<void>;
	handleImportCommand(text: string): Promise<void>;
	handleModelCommand(searchTerm?: string): Promise<void>;
	handleHotkeysCommand(): void;
	handleNameCommand(text: string): void;
	handleReloadCommand(): Promise<void>;
	handleSessionCommand(): void;
	handleShareCommand(): Promise<void>;
	handleSkillsCommand(searchTerm?: string): Promise<void>;
	isExtensionCommand(text: string): boolean;
	queueCompactionMessage(text: string, mode: "steer" | "followUp"): void;
	showModelsSelector(): Promise<void>;
	showOAuthSelector(action: "login" | "logout"): void;
	showSessionSelector(): void;
	showSettingsSelector(): void;
	showTreeSelector(): void;
	showUserMessageSelector(): void;
	showWarning(message: string): void;
	shutdown(): Promise<void>;
	updateEditorBorderColor(): void;
	updatePendingMessagesDisplay(): void;
}

/** Dispatch a submitted editor value to the matching interactive action. */
export async function handleEditorSubmit(target: InteractiveSubmitTarget, text: string): Promise<void> {
	text = text.trim();
	if (!text) return;

	// Handle commands
	if (text === "/settings") {
		target.showSettingsSelector();
		target.editor.setText("");
		return;
	}
	if (text === "/scoped-models") {
		target.editor.setText("");
		await target.showModelsSelector();
		return;
	}
	if (text === "/model" || text.startsWith("/model ")) {
		const searchTerm = text.startsWith("/model ") ? text.slice(7).trim() : undefined;
		target.editor.setText("");
		await target.handleModelCommand(searchTerm);
		return;
	}
	if (text === "/export" || text.startsWith("/export ")) {
		await target.handleExportCommand(text);
		target.editor.setText("");
		return;
	}
	if (text === "/import" || text.startsWith("/import ")) {
		await target.handleImportCommand(text);
		target.editor.setText("");
		return;
	}
	if (text === "/share") {
		await target.handleShareCommand();
		target.editor.setText("");
		return;
	}
	if (text === "/copy") {
		await target.handleCopyCommand();
		target.editor.setText("");
		return;
	}
	if (text === "/name" || text.startsWith("/name ")) {
		target.handleNameCommand(text);
		target.editor.setText("");
		return;
	}
	if (text === "/session") {
		target.handleSessionCommand();
		target.editor.setText("");
		return;
	}
	if (text === "/changelog") {
		target.handleChangelogCommand();
		target.editor.setText("");
		return;
	}
	if (text === "/hotkeys") {
		target.handleHotkeysCommand();
		target.editor.setText("");
		return;
	}
	if (text === "/fork") {
		target.showUserMessageSelector();
		target.editor.setText("");
		return;
	}
	if (text === "/clone") {
		target.editor.setText("");
		await target.handleCloneCommand();
		return;
	}
	if (text === "/tree") {
		target.showTreeSelector();
		target.editor.setText("");
		return;
	}
	if (text === "/login") {
		target.showOAuthSelector("login");
		target.editor.setText("");
		return;
	}
	if (text === "/logout") {
		target.showOAuthSelector("logout");
		target.editor.setText("");
		return;
	}
	if (text === "/new") {
		target.editor.setText("");
		await target.handleClearCommand();
		return;
	}
	if (text === "/compact" || text.startsWith("/compact ")) {
		const customInstructions = text.startsWith("/compact ") ? text.slice(9).trim() : undefined;
		target.editor.setText("");
		await target.handleCompactCommand(customInstructions);
		return;
	}
	if (text === "/reload") {
		target.editor.setText("");
		await target.handleReloadCommand();
		return;
	}
	if (text === "/skills" || text.startsWith("/skills ")) {
		const searchTerm = text.startsWith("/skills ") ? text.slice(8).trim() : undefined;
		target.editor.setText("");
		await target.handleSkillsCommand(searchTerm);
		return;
	}
	if (text === "/debug") {
		target.handleDebugCommand();
		target.editor.setText("");
		return;
	}
	if (text === "/arminsayshi") {
		target.handleArminSaysHi();
		target.editor.setText("");
		return;
	}
	if (text === "/dementedelves") {
		target.handleDementedDelves();
		target.editor.setText("");
		return;
	}
	if (text === "/resume") {
		target.showSessionSelector();
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
		target.updatePendingMessagesDisplay();
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
