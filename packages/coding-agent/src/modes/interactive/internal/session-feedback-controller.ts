/**
 * Interactive feedback and queue presentation helpers.
 *
 * These helpers render warnings/errors and maintain the pending-message display
 * for steer/follow-up queues. Centralizing these UI updates keeps the main mode
 * class focused on orchestration instead of formatting details.
 */

import type { Agent } from "@mariozechner/pi-agent-core";
import { Spacer, Text, TruncatedText } from "@mariozechner/pi-tui";
import { APP_NAME } from "../../../config.js";
import type { AgentSession } from "../../../core/agent-session.js";
import type { BashExecutionComponent } from "../components/bash-execution.js";
import { DynamicBorder } from "../components/dynamic-border.js";
import { theme } from "../theme/theme.js";
import { type CompactionQueuedMessage, clearAllQueuedMessages, getAllQueuedMessages } from "./session-queue.js";

export interface SessionFeedbackTarget {
	agent: Agent;
	session: AgentSession;
	ui: { requestRender(): void };
	chatContainer: { addChild(component: unknown): void };
	pendingMessagesContainer: {
		clear(): void;
		addChild(component: unknown): void;
		removeChild(component: unknown): void;
	};
	editor: {
		getText(): string;
		setText(text: string): void;
		addToHistory?(text: string): void;
	};
	pendingBashComponents: BashExecutionComponent[];
	compactionQueuedMessages: CompactionQueuedMessage[];
	getAppKeyDisplay(action: "app.message.dequeue"): string;
	showStatus(message: string): void;
	showError(message: string): void;
}

/** Render a red error line in the chat timeline. */
export function showError(target: Pick<SessionFeedbackTarget, "chatContainer" | "ui">, errorMessage: string): void {
	target.chatContainer.addChild(new Spacer(1));
	target.chatContainer.addChild(new Text(theme.fg("error", `Error: ${errorMessage}`), 1, 0));
	target.ui.requestRender();
}

/** Render a yellow warning line in the chat timeline. */
export function showWarning(target: Pick<SessionFeedbackTarget, "chatContainer" | "ui">, warningMessage: string): void {
	target.chatContainer.addChild(new Spacer(1));
	target.chatContainer.addChild(new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0));
	target.ui.requestRender();
}

/** Render the new-version notification box. */
export function showNewVersionNotification(
	target: Pick<SessionFeedbackTarget, "chatContainer" | "ui">,
	newVersion: string,
): void {
	const action = theme.fg("accent", `${APP_NAME} update`);
	const updateInstruction = theme.fg("muted", `New version ${newVersion} is available. Run `) + action;
	const changelogUrl = theme.fg(
		"accent",
		"https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/CHANGELOG.md",
	);
	const changelogLine = theme.fg("muted", "Changelog: ") + changelogUrl;

	target.chatContainer.addChild(new Spacer(1));
	target.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
	target.chatContainer.addChild(
		new Text(`${theme.bold(theme.fg("warning", "Update Available"))}\n${updateInstruction}\n${changelogLine}`, 1, 0),
	);
	target.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
	target.ui.requestRender();
}

/** Render the package-updates notification box. */
export function showPackageUpdateNotification(
	target: Pick<SessionFeedbackTarget, "chatContainer" | "ui">,
	packages: string[],
): void {
	const action = theme.fg("accent", `${APP_NAME} update`);
	const updateInstruction = theme.fg("muted", "Package updates are available. Run ") + action;
	const packageLines = packages.map((pkg) => `- ${pkg}`).join("\n");

	target.chatContainer.addChild(new Spacer(1));
	target.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
	target.chatContainer.addChild(
		new Text(
			`${theme.bold(theme.fg("warning", "Package Updates Available"))}\n${updateInstruction}\n${theme.fg("muted", "Packages:")}\n${packageLines}`,
			1,
			0,
		),
	);
	target.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
	target.ui.requestRender();
}

/** Return steer/follow-up messages from both session and compaction queues. */
export function readAllQueuedMessages(target: Pick<SessionFeedbackTarget, "session" | "compactionQueuedMessages">): {
	steering: string[];
	followUp: string[];
} {
	return getAllQueuedMessages(target.session, target.compactionQueuedMessages);
}

/** Clear all pending steer/follow-up queues and reset compaction queue cache. */
export function clearQueuedMessages(target: Pick<SessionFeedbackTarget, "session" | "compactionQueuedMessages">): {
	steering: string[];
	followUp: string[];
} {
	const queuedMessages = clearAllQueuedMessages(target.session, target.compactionQueuedMessages);
	target.compactionQueuedMessages = [];
	return queuedMessages;
}

/** Re-render the queue preview panel below the chat transcript. */
export function updatePendingMessagesDisplay(
	target: Pick<
		SessionFeedbackTarget,
		"pendingMessagesContainer" | "session" | "compactionQueuedMessages" | "getAppKeyDisplay"
	>,
): void {
	target.pendingMessagesContainer.clear();
	const { steering: steeringMessages, followUp: followUpMessages } = readAllQueuedMessages(target);
	if (steeringMessages.length === 0 && followUpMessages.length === 0) {
		return;
	}

	target.pendingMessagesContainer.addChild(new Spacer(1));
	for (const message of steeringMessages) {
		target.pendingMessagesContainer.addChild(new TruncatedText(theme.fg("dim", `Steering: ${message}`), 1, 0));
	}
	for (const message of followUpMessages) {
		target.pendingMessagesContainer.addChild(new TruncatedText(theme.fg("dim", `Follow-up: ${message}`), 1, 0));
	}
	const dequeueHint = target.getAppKeyDisplay("app.message.dequeue");
	target.pendingMessagesContainer.addChild(
		new TruncatedText(theme.fg("dim", `↳ ${dequeueHint} to edit all queued messages`), 1, 0),
	);
}

/** Move queued messages back into the editor for editing (optionally aborting the current run). */
export function restoreQueuedMessagesToEditor(
	target: Pick<
		SessionFeedbackTarget,
		"agent" | "editor" | "session" | "compactionQueuedMessages" | "pendingMessagesContainer" | "getAppKeyDisplay"
	>,
	options?: { abort?: boolean; currentText?: string },
): number {
	const { steering, followUp } = clearQueuedMessages(target);
	const allQueued = [...steering, ...followUp];
	if (allQueued.length === 0) {
		updatePendingMessagesDisplay(target);
		if (options?.abort) target.agent.abort();
		return 0;
	}

	const queuedText = allQueued.join("\n\n");
	const currentText = options?.currentText ?? target.editor.getText();
	target.editor.setText([queuedText, currentText].filter((text) => text.trim()).join("\n\n"));
	updatePendingMessagesDisplay(target);
	if (options?.abort) target.agent.abort();
	return allQueued.length;
}

/** Queue a post-compaction prompt and refresh queue preview. */
export function queueCompactionMessage(
	target: Pick<
		SessionFeedbackTarget,
		"compactionQueuedMessages" | "editor" | "pendingMessagesContainer" | "session" | "getAppKeyDisplay" | "showStatus"
	>,
	text: string,
	mode: "steer" | "followUp",
): void {
	target.compactionQueuedMessages.push({ text, mode });
	target.editor.addToHistory?.(text);
	target.editor.setText("");
	updatePendingMessagesDisplay(target);
	target.showStatus("Queued message for after compaction");
}

/** Move deferred bash components into the main chat transcript. */
export function flushPendingBashComponents(
	target: Pick<SessionFeedbackTarget, "pendingBashComponents" | "pendingMessagesContainer" | "chatContainer">,
): void {
	for (const component of target.pendingBashComponents) {
		target.pendingMessagesContainer.removeChild(component);
		target.chatContainer.addChild(component);
	}
	target.pendingBashComponents = [];
}
