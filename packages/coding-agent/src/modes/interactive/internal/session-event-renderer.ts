/**
 * Agent event rendering for InteractiveMode.
 *
 * AgentSession owns event production. This module owns the interactive rendering
 * side effects for those events: streaming assistant messages, tool components,
 * compaction indicators, retry countdowns, footer invalidation, and shutdown
 * checks after agent completion.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { Container, MarkdownTheme, TUI } from "@mariozechner/pi-tui";
import { Loader, Spacer, Text } from "@mariozechner/pi-tui";
import type { TSchema } from "typebox";
import type { AgentSession, AgentSessionEvent } from "../../../core/agent-session.js";
import type { ToolDefinition } from "../../../core/extensions/types.js";
import { createCompactionSummaryMessage } from "../../../core/messages.js";
import type { SessionManager } from "../../../core/session-manager.js";
import type { SettingsManager } from "../../../core/settings-manager.js";
import { AssistantMessageComponent } from "../components/assistant-message.js";
import { CountdownTimer } from "../components/countdown-timer.js";
import type { CustomEditor } from "../components/custom-editor.js";
import type { FooterComponent } from "../components/footer.js";
import { keyText } from "../components/keybinding-hints.js";
import { ToolExecutionComponent } from "../components/tool-execution.js";
import { theme } from "../theme/theme.js";

export interface InteractiveEventTarget {
	autoCompactionEscapeHandler?: () => void;
	autoCompactionLoader: Loader | undefined;
	chatContainer: Container;
	defaultEditor: CustomEditor;
	footer: FooterComponent;
	hiddenThinkingLabel: string;
	hideThinkingBlock: boolean;
	isInitialized: boolean;
	loadingAnimation: Loader | undefined;
	pendingTools: Map<string, ToolExecutionComponent>;
	retryCountdown: CountdownTimer | undefined;
	retryEscapeHandler?: () => void;
	retryLoader: Loader | undefined;
	session: AgentSession;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	statusContainer: Container;
	streamingComponent: AssistantMessageComponent | undefined;
	streamingMessage: AssistantMessage | undefined;
	toolOutputExpanded: boolean;
	ui: TUI;
	addMessageToChat(message: AgentMessage): void;
	checkShutdownRequested(): Promise<void>;
	createWorkingLoader(): Loader;
	flushCompactionQueue(options: { willRetry?: boolean }): Promise<void>;
	getMarkdownThemeWithSettings(): MarkdownTheme;
	getRegisteredToolDefinition(toolName: string): ToolDefinition<TSchema, unknown, unknown> | undefined;
	init(): Promise<void>;
	rebuildChatFromMessages(): void;
	showError(message: string): void;
	showStatus(message: string): void;
	stopWorkingLoader(): void;
	updatePendingMessagesDisplay(): void;
	updateTerminalTitle(): void;
	workingVisible: boolean;
}

/** Apply one AgentSession event to the interactive UI. */
export async function handleInteractiveEvent(target: InteractiveEventTarget, event: AgentSessionEvent): Promise<void> {
	if (!target.isInitialized) {
		await target.init();
	}

	target.footer.invalidate();

	switch (event.type) {
		case "agent_start":
			if (target.settingsManager.getShowTerminalProgress()) {
				target.ui.terminal.setProgress(true);
			}
			// Restore main escape handler if retry handler is still active
			// (retry success event fires later, but we need main handler now)
			if (target.retryEscapeHandler) {
				target.defaultEditor.onEscape = target.retryEscapeHandler;
				target.retryEscapeHandler = undefined;
			}
			if (target.retryCountdown) {
				target.retryCountdown.dispose();
				target.retryCountdown = undefined;
			}
			if (target.retryLoader) {
				target.retryLoader.stop();
				target.retryLoader = undefined;
			}
			target.stopWorkingLoader();
			if (target.workingVisible) {
				target.loadingAnimation = target.createWorkingLoader();
				target.statusContainer.addChild(target.loadingAnimation);
			}
			target.ui.requestRender();
			break;

		case "queue_update":
			target.updatePendingMessagesDisplay();
			target.ui.requestRender();
			break;

		case "session_info_changed":
			target.updateTerminalTitle();
			target.footer.invalidate();
			target.ui.requestRender();
			break;

		case "message_start":
			if (event.message.role === "custom") {
				target.addMessageToChat(event.message);
				target.ui.requestRender();
			} else if (event.message.role === "user") {
				target.addMessageToChat(event.message);
				target.updatePendingMessagesDisplay();
				target.ui.requestRender();
			} else if (event.message.role === "assistant") {
				target.streamingComponent = new AssistantMessageComponent(
					undefined,
					target.hideThinkingBlock,
					target.getMarkdownThemeWithSettings(),
					target.hiddenThinkingLabel,
				);
				target.streamingMessage = event.message;
				target.chatContainer.addChild(target.streamingComponent);
				target.streamingComponent.updateContent(target.streamingMessage);
				target.ui.requestRender();
			}
			break;

		case "message_update":
			if (target.streamingComponent && event.message.role === "assistant") {
				target.streamingMessage = event.message;
				target.streamingComponent.updateContent(target.streamingMessage);

				for (const content of target.streamingMessage.content) {
					if (content.type === "toolCall") {
						if (!target.pendingTools.has(content.id)) {
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
							target.pendingTools.set(content.id, component);
						} else {
							const component = target.pendingTools.get(content.id);
							if (component) {
								component.updateArgs(content.arguments);
							}
						}
					}
				}
				target.ui.requestRender();
			}
			break;

		case "message_end":
			if (event.message.role === "user") break;
			if (target.streamingComponent && event.message.role === "assistant") {
				target.streamingMessage = event.message;
				let errorMessage: string | undefined;
				if (target.streamingMessage.stopReason === "aborted") {
					const retryAttempt = target.session.retryAttempt;
					errorMessage =
						retryAttempt > 0
							? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
							: "Operation aborted";
					target.streamingMessage.errorMessage = errorMessage;
				}
				target.streamingComponent.updateContent(target.streamingMessage);

				if (target.streamingMessage.stopReason === "aborted" || target.streamingMessage.stopReason === "error") {
					if (!errorMessage) {
						errorMessage = target.streamingMessage.errorMessage || "Error";
					}
					for (const [, component] of target.pendingTools.entries()) {
						component.updateResult({
							content: [{ type: "text", text: errorMessage }],
							isError: true,
						});
					}
					target.pendingTools.clear();
				} else {
					// Args are now complete - trigger diff computation for edit tools
					for (const [, component] of target.pendingTools.entries()) {
						component.setArgsComplete();
					}
				}
				target.streamingComponent = undefined;
				target.streamingMessage = undefined;
				target.footer.invalidate();
			}
			target.ui.requestRender();
			break;

		case "tool_execution_start": {
			let component = target.pendingTools.get(event.toolCallId);
			if (!component) {
				component = new ToolExecutionComponent(
					event.toolName,
					event.toolCallId,
					event.args,
					{
						showImages: target.settingsManager.getShowImages(),
						imageWidthCells: target.settingsManager.getImageWidthCells(),
					},
					target.getRegisteredToolDefinition(event.toolName),
					target.ui,
					target.sessionManager.getCwd(),
				);
				component.setExpanded(target.toolOutputExpanded);
				target.chatContainer.addChild(component);
				target.pendingTools.set(event.toolCallId, component);
			}
			component.markExecutionStarted();
			target.ui.requestRender();
			break;
		}

		case "tool_execution_update": {
			const component = target.pendingTools.get(event.toolCallId);
			if (component) {
				component.updateResult({ ...event.partialResult, isError: false }, true);
				target.ui.requestRender();
			}
			break;
		}

		case "tool_execution_end": {
			const component = target.pendingTools.get(event.toolCallId);
			if (component) {
				component.updateResult({ ...event.result, isError: event.isError });
				target.pendingTools.delete(event.toolCallId);
				target.ui.requestRender();
			}
			break;
		}

		case "agent_end":
			if (target.settingsManager.getShowTerminalProgress()) {
				target.ui.terminal.setProgress(false);
			}
			if (target.loadingAnimation) {
				target.loadingAnimation.stop();
				target.loadingAnimation = undefined;
				target.statusContainer.clear();
			}
			if (target.streamingComponent) {
				target.chatContainer.removeChild(target.streamingComponent);
				target.streamingComponent = undefined;
				target.streamingMessage = undefined;
			}
			target.pendingTools.clear();

			await target.checkShutdownRequested();

			target.ui.requestRender();
			break;

		case "compaction_start": {
			if (target.settingsManager.getShowTerminalProgress()) {
				target.ui.terminal.setProgress(true);
			}
			// Keep editor active; submissions are queued during compaction.
			target.autoCompactionEscapeHandler = target.defaultEditor.onEscape;
			target.defaultEditor.onEscape = () => {
				target.session.abortCompaction();
			};
			target.statusContainer.clear();
			const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
			const label =
				event.reason === "manual"
					? `Compacting context... ${cancelHint}`
					: `${event.reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`;
			target.autoCompactionLoader = new Loader(
				target.ui,
				(spinner) => theme.fg("accent", spinner),
				(text) => theme.fg("muted", text),
				label,
			);
			target.statusContainer.addChild(target.autoCompactionLoader);
			target.ui.requestRender();
			break;
		}

		case "compaction_end": {
			if (target.settingsManager.getShowTerminalProgress()) {
				target.ui.terminal.setProgress(false);
			}
			if (target.autoCompactionEscapeHandler) {
				target.defaultEditor.onEscape = target.autoCompactionEscapeHandler;
				target.autoCompactionEscapeHandler = undefined;
			}
			if (target.autoCompactionLoader) {
				target.autoCompactionLoader.stop();
				target.autoCompactionLoader = undefined;
				target.statusContainer.clear();
			}
			if (event.aborted) {
				if (event.reason === "manual") {
					target.showError("Compaction cancelled");
				} else {
					target.showStatus("Auto-compaction cancelled");
				}
			} else if (event.result) {
				target.chatContainer.clear();
				target.rebuildChatFromMessages();
				target.addMessageToChat(
					createCompactionSummaryMessage(
						event.result.summary,
						event.result.tokensBefore,
						new Date().toISOString(),
					),
				);
				target.footer.invalidate();
			} else if (event.errorMessage) {
				if (event.reason === "manual") {
					target.showError(event.errorMessage);
				} else {
					target.chatContainer.addChild(new Spacer(1));
					target.chatContainer.addChild(new Text(theme.fg("error", event.errorMessage), 1, 0));
				}
			}
			void target.flushCompactionQueue({ willRetry: event.willRetry });
			target.ui.requestRender();
			break;
		}

		case "auto_retry_start": {
			// Set up escape to abort retry
			target.retryEscapeHandler = target.defaultEditor.onEscape;
			target.defaultEditor.onEscape = () => {
				target.session.abortRetry();
			};
			// Show retry indicator
			target.statusContainer.clear();
			target.retryCountdown?.dispose();
			const retryMessage = (seconds: number) =>
				`Retrying (${event.attempt}/${event.maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`;
			target.retryLoader = new Loader(
				target.ui,
				(spinner) => theme.fg("warning", spinner),
				(text) => theme.fg("muted", text),
				retryMessage(Math.ceil(event.delayMs / 1000)),
			);
			target.retryCountdown = new CountdownTimer(
				event.delayMs,
				target.ui,
				(seconds) => {
					target.retryLoader?.setMessage(retryMessage(seconds));
				},
				() => {
					target.retryCountdown = undefined;
				},
			);
			target.statusContainer.addChild(target.retryLoader);
			target.ui.requestRender();
			break;
		}

		case "auto_retry_end": {
			// Restore escape handler
			if (target.retryEscapeHandler) {
				target.defaultEditor.onEscape = target.retryEscapeHandler;
				target.retryEscapeHandler = undefined;
			}
			if (target.retryCountdown) {
				target.retryCountdown.dispose();
				target.retryCountdown = undefined;
			}
			// Stop loader
			if (target.retryLoader) {
				target.retryLoader.stop();
				target.retryLoader = undefined;
				target.statusContainer.clear();
			}
			// Show error only on final failure (success shows normal response)
			if (!event.success) {
				target.showError(`Retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`);
			}
			target.ui.requestRender();
			break;
		}
	}
}
