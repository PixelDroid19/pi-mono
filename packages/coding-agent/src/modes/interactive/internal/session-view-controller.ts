/**
 * Session view rendering for InteractiveMode.
 *
 * This module translates persisted agent/session messages into TUI components.
 * It owns chat reconstruction, status coalescing, and history population so
 * event handling can request rendering without knowing component-level details.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message } from "@mariozechner/pi-ai";
import type { Container, EditorComponent, MarkdownTheme, TUI } from "@mariozechner/pi-tui";
import { Spacer, Text } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import { parseSkillBlock } from "../../../core/agent-session.js";
import type { SessionContext, SessionManager } from "../../../core/session-manager.js";
import type { SettingsManager } from "../../../core/settings-manager.js";
import type { TruncationResult } from "../../../core/tools/truncate.js";
import { AssistantMessageComponent } from "../components/assistant-message.js";
import { BashExecutionComponent } from "../components/bash-execution.js";
import { BranchSummaryMessageComponent } from "../components/branch-summary-message.js";
import { CompactionSummaryMessageComponent } from "../components/compaction-summary-message.js";
import { CustomMessageComponent } from "../components/custom-message.js";
import type { FooterComponent } from "../components/footer.js";
import { SkillInvocationMessageComponent } from "../components/skill-invocation-message.js";
import { ToolExecutionComponent } from "../components/tool-execution.js";
import { UserMessageComponent } from "../components/user-message.js";
import { theme } from "../theme/theme.js";

export interface SessionViewTarget {
	chatContainer: Container;
	editor: EditorComponent;
	footer: FooterComponent;
	hiddenThinkingLabel: string;
	hideThinkingBlock: boolean;
	lastStatusSpacer: Spacer | undefined;
	lastStatusText: Text | undefined;
	pendingTools: Map<string, ToolExecutionComponent>;
	session: AgentSession;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	toolOutputExpanded: boolean;
	ui: TUI;
	getMarkdownThemeWithSettings(): MarkdownTheme;
	getRegisteredToolDefinition(toolName: string): ReturnType<AgentSession["getToolDefinition"]>;
	updateEditorBorderColor(): void;
}

export function getUserMessageText(message: Message): string {
	if (message.role !== "user") return "";
	const textBlocks =
		typeof message.content === "string"
			? [{ type: "text", text: message.content }]
			: message.content.filter((content: { type: string }) => content.type === "text");
	return textBlocks.map((content) => (content as { text: string }).text).join("");
}

export function showStatus(target: SessionViewTarget, message: string): void {
	const children = target.chatContainer.children;
	const last = children.length > 0 ? children[children.length - 1] : undefined;
	const secondLast = children.length > 1 ? children[children.length - 2] : undefined;

	if (last && secondLast && last === target.lastStatusText && secondLast === target.lastStatusSpacer) {
		target.lastStatusText.setText(theme.fg("dim", message));
		target.ui.requestRender();
		return;
	}

	const spacer = new Spacer(1);
	const text = new Text(theme.fg("dim", message), 1, 0);
	target.chatContainer.addChild(spacer);
	target.chatContainer.addChild(text);
	target.lastStatusSpacer = spacer;
	target.lastStatusText = text;
	target.ui.requestRender();
}

export function addMessageToChat(
	target: SessionViewTarget,
	message: AgentMessage,
	options?: { populateHistory?: boolean },
): void {
	switch (message.role) {
		case "bashExecution": {
			const component = new BashExecutionComponent(message.command, target.ui, message.excludeFromContext);
			if (message.output) component.appendOutput(message.output);
			component.setComplete(
				message.exitCode,
				message.cancelled,
				message.truncated ? ({ truncated: true } as TruncationResult) : undefined,
				message.fullOutputPath,
			);
			target.chatContainer.addChild(component);
			break;
		}
		case "custom": {
			if (message.display) {
				const renderer = target.session.extensionRunner.getMessageRenderer(message.customType);
				const component = new CustomMessageComponent(message, renderer, target.getMarkdownThemeWithSettings());
				component.setExpanded(target.toolOutputExpanded);
				target.chatContainer.addChild(component);
			}
			break;
		}
		case "compactionSummary": {
			target.chatContainer.addChild(new Spacer(1));
			const component = new CompactionSummaryMessageComponent(message, target.getMarkdownThemeWithSettings());
			component.setExpanded(target.toolOutputExpanded);
			target.chatContainer.addChild(component);
			break;
		}
		case "branchSummary": {
			target.chatContainer.addChild(new Spacer(1));
			const component = new BranchSummaryMessageComponent(message, target.getMarkdownThemeWithSettings());
			component.setExpanded(target.toolOutputExpanded);
			target.chatContainer.addChild(component);
			break;
		}
		case "user": {
			const textContent = getUserMessageText(message);
			if (!textContent) break;
			if (target.chatContainer.children.length > 0) target.chatContainer.addChild(new Spacer(1));
			const skillBlock = parseSkillBlock(textContent);
			if (skillBlock) {
				const component = new SkillInvocationMessageComponent(skillBlock, target.getMarkdownThemeWithSettings());
				component.setExpanded(target.toolOutputExpanded);
				target.chatContainer.addChild(component);
				if (skillBlock.userMessage) {
					target.chatContainer.addChild(
						new UserMessageComponent(skillBlock.userMessage, target.getMarkdownThemeWithSettings()),
					);
				}
			} else {
				target.chatContainer.addChild(new UserMessageComponent(textContent, target.getMarkdownThemeWithSettings()));
			}
			if (options?.populateHistory) target.editor.addToHistory?.(textContent);
			break;
		}
		case "assistant": {
			const component = new AssistantMessageComponent(
				message as AssistantMessage,
				target.hideThinkingBlock,
				target.getMarkdownThemeWithSettings(),
				target.hiddenThinkingLabel,
			);
			target.chatContainer.addChild(component);
			break;
		}
		case "toolResult":
			break;
		default: {
			const _exhaustive: never = message;
			void _exhaustive;
		}
	}
}

export function renderSessionContext(
	target: SessionViewTarget,
	sessionContext: SessionContext,
	options: { updateFooter?: boolean; populateHistory?: boolean } = {},
): void {
	target.pendingTools.clear();

	if (options.updateFooter) {
		target.footer.invalidate();
		target.updateEditorBorderColor();
	}

	for (const message of sessionContext.messages) {
		if (message.role === "assistant") {
			addMessageToChat(target, message);
			for (const content of message.content) {
				if (content.type !== "toolCall") continue;
				const component = new ToolExecutionComponent(
					content.name,
					content.id,
					content.arguments,
					{
						showImages: target.settingsManager.getShowImages(),
						imageWidthCells: target.settingsManager.getImageWidthCells(),
					},
					target.getRegisteredToolDefinition(content.name),
					target.ui,
					target.sessionManager.getCwd(),
				);
				component.setExpanded(target.toolOutputExpanded);
				target.chatContainer.addChild(component);

				if (message.stopReason === "aborted" || message.stopReason === "error") {
					let errorMessage: string;
					if (message.stopReason === "aborted") {
						const retryAttempt = target.session.retryAttempt;
						errorMessage =
							retryAttempt > 0
								? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
								: "Operation aborted";
					} else {
						errorMessage = message.errorMessage || "Error";
					}
					component.updateResult({ content: [{ type: "text", text: errorMessage }], isError: true });
				} else {
					target.pendingTools.set(content.id, component);
				}
			}
		} else if (message.role === "toolResult") {
			const component = target.pendingTools.get(message.toolCallId);
			if (component) {
				component.updateResult(message);
				target.pendingTools.delete(message.toolCallId);
			}
		} else {
			addMessageToChat(target, message, options);
		}
	}

	target.pendingTools.clear();
	target.ui.requestRender();
}

export function renderInitialMessages(target: SessionViewTarget): void {
	const context = target.sessionManager.buildSessionContext();
	renderSessionContext(target, context, { updateFooter: true, populateHistory: true });

	const allEntries = target.sessionManager.getEntries();
	const compactionCount = allEntries.filter((entry) => entry.type === "compaction").length;
	if (compactionCount > 0) {
		const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`;
		showStatus(target, `Session compacted ${times}`);
	}
}

export function rebuildChatFromMessages(target: SessionViewTarget): void {
	target.chatContainer.clear();
	renderSessionContext(target, target.sessionManager.buildSessionContext());
}
