/**
 * AgentSession event and retry state boundary.
 *
 * Agent events update session history, notify SDK consumers, forward extension
 * hooks, and schedule retry/overflow recovery. Keeping those side effects in
 * one module preserves ordering while allowing AgentSession to remain the public
 * facade instead of the owner of every event branch.
 */

import type { Agent, AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message, TextContent } from "@mariozechner/pi-ai";
import { isContextOverflow } from "@mariozechner/pi-ai";
import { sleep } from "../../utils/sleep.js";
import type { AgentSessionEvent } from "../agent-session.js";
import type { ExtensionRunner } from "../extensions/index.js";
import type { SessionManager } from "../session-manager.js";
import type { SettingsManager } from "../settings-manager.js";
import { forwardAgentEventToExtensions } from "./event-bridge.js";

/**
 * Internal AgentSession shape required by the event and retry helpers.
 *
 * The concrete AgentSession instance is cast to this interface by the facade.
 * All fields are private implementation state; adding a property here means the
 * helper now depends on that state transition and should stay covered by tests.
 */
export interface AgentSessionEventTarget {
	agent: Agent;
	sessionManager: Pick<SessionManager, "appendCustomMessageEntry" | "appendMessage">;
	settingsManager: Pick<SettingsManager, "getRetrySettings">;
	_extensionRunner: ExtensionRunner;
	_turnIndex: number;
	_steeringMessages: string[];
	_followUpMessages: string[];
	_lastAssistantMessage: AssistantMessage | undefined;
	_overflowRecoveryAttempted: boolean;
	_retryAttempt: number;
	_retryPromise: Promise<void> | undefined;
	_retryResolve: (() => void) | undefined;
	_retryAbortController: AbortController | undefined;
	_emit(event: AgentSessionEvent): void;
	_emitQueueUpdate(): void;
	_emitExtensionEvent(event: AgentEvent): Promise<void>;
	_isRetryableError(message: AssistantMessage): boolean;
	_handleRetryableError(message: AssistantMessage): Promise<boolean>;
	_resolveRetry(): void;
	_checkCompaction(message: AssistantMessage, skipAbortedCheck?: boolean): Promise<void>;
	_findLastAssistantInMessages(messages: AgentMessage[]): AssistantMessage | undefined;
}

/**
 * Extract the textual content of a user message for queue bookkeeping.
 */
export function getUserMessageText(message: Message): string {
	if (message.role !== "user") {
		return "";
	}

	const { content } = message;
	if (typeof content === "string") {
		return content;
	}

	return content
		.filter((part): part is TextContent => part.type === "text")
		.map((part) => part.text)
		.join("");
}

/**
 * Find the last assistant message in an arbitrary message list.
 */
export function findLastAssistantInMessages(messages: AgentMessage[]): AssistantMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role === "assistant") {
			return message as AssistantMessage;
		}
	}

	return undefined;
}

/**
 * Find the last assistant message in the current agent state.
 */
export function findLastAssistantMessage(messages: AgentMessage[]): AssistantMessage | undefined {
	return findLastAssistantInMessages(messages);
}

/**
 * Create the pending retry promise as soon as an `agent_end` event arrives so
 * prompt callers cannot miss an in-flight retry.
 */
export function createRetryPromiseForAgentEnd(target: AgentSessionEventTarget, event: AgentEvent): void {
	if (event.type !== "agent_end" || target._retryPromise) {
		return;
	}

	const settings = target.settingsManager.getRetrySettings();
	if (!settings.enabled) {
		return;
	}

	const lastAssistant = target._findLastAssistantInMessages(event.messages);
	if (!lastAssistant || !target._isRetryableError(lastAssistant)) {
		return;
	}

	target._retryPromise = new Promise((resolve) => {
		target._retryResolve = resolve;
	});
}

/**
 * Forward agent events to extensions while preserving the internal turn index.
 */
export async function emitExtensionEvent(target: AgentSessionEventTarget, event: AgentEvent): Promise<void> {
	target._turnIndex = await forwardAgentEventToExtensions(event, target._extensionRunner, target._turnIndex);
}

/**
 * Resolve and clear the pending retry promise.
 */
export function resolveRetry(target: AgentSessionEventTarget): void {
	if (!target._retryResolve) {
		return;
	}

	target._retryResolve();
	target._retryResolve = undefined;
	target._retryPromise = undefined;
}

/**
 * Decide whether an assistant error should trigger auto-retry.
 *
 * Context overflow stays excluded because compaction handles that path instead.
 */
export function isRetryableAssistantError(message: AssistantMessage, contextWindow = 0): boolean {
	if (message.stopReason !== "error" || !message.errorMessage) {
		return false;
	}

	if (isContextOverflow(message, contextWindow)) {
		return false;
	}

	return /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i.test(
		message.errorMessage,
	);
}

/**
 * Process a single agent event, including queue bookkeeping, persistence,
 * extension forwarding, retry, and post-turn compaction checks.
 */
export async function processAgentEvent(target: AgentSessionEventTarget, event: AgentEvent): Promise<void> {
	if (event.type === "message_start" && event.message.role === "user") {
		target._overflowRecoveryAttempted = false;
		const messageText = getUserMessageText(event.message);

		if (messageText) {
			const steeringIndex = target._steeringMessages.indexOf(messageText);
			if (steeringIndex !== -1) {
				target._steeringMessages.splice(steeringIndex, 1);
				target._emitQueueUpdate();
			} else {
				const followUpIndex = target._followUpMessages.indexOf(messageText);
				if (followUpIndex !== -1) {
					target._followUpMessages.splice(followUpIndex, 1);
					target._emitQueueUpdate();
				}
			}
		}
	}

	await target._emitExtensionEvent(event);
	target._emit(event as AgentSessionEvent);

	if (event.type === "message_end") {
		if (event.message.role === "custom") {
			target.sessionManager.appendCustomMessageEntry(
				event.message.customType,
				event.message.content,
				event.message.display,
				event.message.details,
			);
		} else if (
			event.message.role === "user" ||
			event.message.role === "assistant" ||
			event.message.role === "toolResult"
		) {
			target.sessionManager.appendMessage(event.message);
		}

		if (event.message.role === "assistant") {
			target._lastAssistantMessage = event.message;

			if (event.message.stopReason !== "error") {
				target._overflowRecoveryAttempted = false;
			}

			if (event.message.stopReason !== "error" && target._retryAttempt > 0) {
				target._emit({
					type: "auto_retry_end",
					success: true,
					attempt: target._retryAttempt,
				});
				target._retryAttempt = 0;
			}
		}
	}

	if (event.type === "agent_end" && target._lastAssistantMessage) {
		const lastAssistantMessage = target._lastAssistantMessage;
		target._lastAssistantMessage = undefined;

		if (target._isRetryableError(lastAssistantMessage)) {
			const didRetry = await target._handleRetryableError(lastAssistantMessage);
			if (didRetry) {
				return;
			}
		}

		target._resolveRetry();
		await target._checkCompaction(lastAssistantMessage);
	}
}

/**
 * Execute the auto-retry policy with exponential backoff.
 */
export async function handleRetryableError(
	target: AgentSessionEventTarget,
	message: AssistantMessage,
): Promise<boolean> {
	const settings = target.settingsManager.getRetrySettings();
	if (!settings.enabled) {
		target._resolveRetry();
		return false;
	}

	if (!target._retryPromise) {
		target._retryPromise = new Promise((resolve) => {
			target._retryResolve = resolve;
		});
	}

	target._retryAttempt++;

	if (target._retryAttempt > settings.maxRetries) {
		target._emit({
			type: "auto_retry_end",
			success: false,
			attempt: target._retryAttempt - 1,
			finalError: message.errorMessage,
		});
		target._retryAttempt = 0;
		target._resolveRetry();
		return false;
	}

	const delayMs = settings.baseDelayMs * 2 ** (target._retryAttempt - 1);

	target._emit({
		type: "auto_retry_start",
		attempt: target._retryAttempt,
		maxAttempts: settings.maxRetries,
		delayMs,
		errorMessage: message.errorMessage || "Unknown error",
	});

	const messages = target.agent.state.messages;
	if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
		target.agent.state.messages = messages.slice(0, -1);
	}

	target._retryAbortController = new AbortController();
	try {
		await sleep(delayMs, target._retryAbortController.signal);
	} catch {
		const attempt = target._retryAttempt;
		target._retryAttempt = 0;
		target._retryAbortController = undefined;
		target._emit({
			type: "auto_retry_end",
			success: false,
			attempt,
			finalError: "Retry cancelled",
		});
		target._resolveRetry();
		return false;
	}

	target._retryAbortController = undefined;

	setTimeout(() => {
		target.agent.continue().catch(() => {});
	}, 0);

	return true;
}

/**
 * Abort an in-flight retry countdown and release any waiter.
 */
export function abortRetry(target: AgentSessionEventTarget): void {
	target._retryAbortController?.abort();
	target._resolveRetry();
}

/**
 * Wait for the active retry cycle, if any, to finish.
 */
export async function waitForRetry(target: AgentSessionEventTarget): Promise<void> {
	if (!target._retryPromise) {
		return;
	}

	await target._retryPromise;
	await target.agent.waitForIdle();
}
