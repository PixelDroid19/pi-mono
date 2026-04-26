/** Session control actions shared by keyboard handlers and submit handlers. */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { Component, Container, EditorComponent, TUI } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { AgentSessionRuntime } from "../../../core/agent-session-runtime.js";
import type { SettingsManager } from "../../../core/settings-manager.js";
import { killTrackedDetachedChildren } from "../../../utils/shell.js";
import { isExpandable } from "../components/expandable-text.js";
import type { FooterComponent } from "../components/footer.js";
import { theme } from "../theme/theme.js";

export interface SessionControlTarget {
	agent: AgentSession["agent"];
	builtInHeader: Component | undefined;
	chatContainer: Container;
	customHeader: (Component & { dispose?(): void }) | undefined;
	editor: EditorComponent;
	footer: FooterComponent;
	hideThinkingBlock: boolean;
	isBashMode: boolean;
	lastSigintTime: number;
	runtimeHost: AgentSessionRuntime;
	settingsManager: SettingsManager;
	session: AgentSession;
	signalCleanupHandlers: Array<() => void>;
	streamingComponent:
		| { setHideThinkingBlock(value: boolean): void; updateContent(message: AssistantMessage): void }
		| undefined;
	streamingMessage: AssistantMessage | undefined;
	toolOutputExpanded: boolean;
	ui: TUI;
	clearEditor(): void;
	isExtensionCommand(text: string): boolean;
	queueCompactionMessage(text: string, mode: "steer" | "followUp"): void;
	rebuildChatFromMessages(): void;
	restoreQueuedMessagesToEditor(options?: { abort?: boolean; currentText?: string }): number;
	showError(message: string): void;
	showStatus(message: string): void;
	showWarning(message: string): void;
	updateEditorBorderColor(): void;
	updatePendingMessagesDisplay(): void;
	stop(): void;
}

export function handleCtrlC(target: SessionControlTarget): void {
	const now = Date.now();
	if (now - target.lastSigintTime < 500) void shutdown(target);
	else {
		target.clearEditor();
		target.lastSigintTime = now;
	}
}

export function handleCtrlD(target: SessionControlTarget): void {
	void shutdown(target);
}

export async function shutdown(target: SessionControlTarget): Promise<void> {
	unregisterSignalHandlers(target);
	await target.ui.terminal.drainInput(1000);
	target.stop();
	await target.runtimeHost.dispose();
	process.exit(0);
}

export async function checkShutdownRequested(target: SessionControlTarget, requested: boolean): Promise<void> {
	if (requested) await shutdown(target);
}

export function registerSignalHandlers(target: SessionControlTarget): void {
	unregisterSignalHandlers(target);
	const signals: NodeJS.Signals[] = ["SIGTERM"];
	if (process.platform !== "win32") signals.push("SIGHUP");
	for (const signal of signals) {
		const handler = () => {
			killTrackedDetachedChildren();
			void shutdown(target);
		};
		process.on(signal, handler);
		target.signalCleanupHandlers.push(() => process.off(signal, handler));
	}
}

export function unregisterSignalHandlers(target: SessionControlTarget): void {
	for (const cleanup of target.signalCleanupHandlers) cleanup();
	target.signalCleanupHandlers = [];
}

export function handleCtrlZ(target: SessionControlTarget): void {
	if (process.platform === "win32") {
		target.showStatus("Suspend to background is not supported on Windows");
		return;
	}
	const suspendKeepAlive = setInterval(() => {}, 2 ** 30);
	const ignoreSigint = () => {};
	process.on("SIGINT", ignoreSigint);
	process.once("SIGCONT", () => {
		clearInterval(suspendKeepAlive);
		process.removeListener("SIGINT", ignoreSigint);
		target.ui.start();
		target.ui.requestRender(true);
	});
	try {
		target.ui.stop();
		process.kill(0, "SIGTSTP");
	} catch (error) {
		clearInterval(suspendKeepAlive);
		process.removeListener("SIGINT", ignoreSigint);
		throw error;
	}
}

export async function handleFollowUp(target: SessionControlTarget): Promise<void> {
	const text = (target.editor.getExpandedText?.() ?? target.editor.getText()).trim();
	if (!text) return;
	if (target.session.isCompacting) {
		if (target.isExtensionCommand(text)) {
			target.editor.addToHistory?.(text);
			target.editor.setText("");
			await target.session.prompt(text);
		} else target.queueCompactionMessage(text, "followUp");
		return;
	}
	if (target.session.isStreaming) {
		target.editor.addToHistory?.(text);
		target.editor.setText("");
		await target.session.prompt(text, { streamingBehavior: "followUp" });
		target.updatePendingMessagesDisplay();
		target.ui.requestRender();
	} else if (target.editor.onSubmit) target.editor.onSubmit(text);
}

export function handleDequeue(target: SessionControlTarget): void {
	const restored = target.restoreQueuedMessagesToEditor();
	target.showStatus(
		restored === 0
			? "No queued messages to restore"
			: `Restored ${restored} queued message${restored > 1 ? "s" : ""} to editor`,
	);
}

export function updateEditorBorderColor(target: SessionControlTarget): void {
	target.editor.borderColor = target.isBashMode
		? theme.getBashModeBorderColor()
		: theme.getThinkingBorderColor(target.session.thinkingLevel || "off");
	target.ui.requestRender();
}

export function cycleThinkingLevel(target: SessionControlTarget): void {
	const newLevel = target.session.cycleThinkingLevel();
	if (newLevel === undefined) target.showStatus("Current model does not support thinking");
	else {
		target.footer.invalidate();
		target.updateEditorBorderColor();
		target.showStatus(`Thinking level: ${newLevel}`);
	}
}

export async function cycleModel(
	target: SessionControlTarget,
	direction: "forward" | "backward",
	warn: (model: AgentSession["model"]) => void,
): Promise<void> {
	try {
		const result = await target.session.cycleModel(direction);
		if (result === undefined)
			target.showStatus(
				target.session.scopedModels.length > 0 ? "Only one model in scope" : "Only one model available",
			);
		else {
			target.footer.invalidate();
			target.updateEditorBorderColor();
			const thinkingStr =
				result.model.reasoning && result.thinkingLevel !== "off" ? ` (thinking: ${result.thinkingLevel})` : "";
			target.showStatus(`Switched to ${result.model.name || result.model.id}${thinkingStr}`);
			warn(result.model);
		}
	} catch (error) {
		target.showError(error instanceof Error ? error.message : String(error));
	}
}

export function setToolsExpanded(target: SessionControlTarget, expanded: boolean): void {
	target.toolOutputExpanded = expanded;
	const activeHeader = target.customHeader ?? target.builtInHeader;
	if (isExpandable(activeHeader)) activeHeader.setExpanded(expanded);
	for (const child of target.chatContainer.children) if (isExpandable(child)) child.setExpanded(expanded);
	target.ui.requestRender();
}

export function toggleThinkingBlockVisibility(target: SessionControlTarget): void {
	target.hideThinkingBlock = !target.hideThinkingBlock;
	target.settingsManager.setHideThinkingBlock(target.hideThinkingBlock);
	target.chatContainer.clear();
	target.rebuildChatFromMessages();
	if (target.streamingComponent && target.streamingMessage) {
		target.streamingComponent.setHideThinkingBlock(target.hideThinkingBlock);
		target.streamingComponent.updateContent(target.streamingMessage);
		target.chatContainer.addChild(target.streamingComponent as unknown as Component);
	}
	target.showStatus(`Thinking blocks: ${target.hideThinkingBlock ? "hidden" : "visible"}`);
}

export function openExternalEditor(target: SessionControlTarget): void {
	const editorCmd = process.env.VISUAL || process.env.EDITOR;
	if (!editorCmd) {
		target.showWarning("No editor configured. Set $VISUAL or $EDITOR environment variable.");
		return;
	}
	const currentText = target.editor.getExpandedText?.() ?? target.editor.getText();
	const tmpFile = path.join(os.tmpdir(), `pi-editor-${Date.now()}.pi.md`);
	try {
		fs.writeFileSync(tmpFile, currentText, "utf-8");
		target.ui.stop();
		const [editor, ...editorArgs] = editorCmd.split(" ");
		const result = spawnSync(editor, [...editorArgs, tmpFile], {
			stdio: "inherit",
			shell: process.platform === "win32",
		});
		if (result.status === 0) target.editor.setText(fs.readFileSync(tmpFile, "utf-8").replace(/\n$/, ""));
	} finally {
		try {
			fs.unlinkSync(tmpFile);
		} catch {}
		target.ui.start();
		target.ui.requestRender(true);
	}
}
