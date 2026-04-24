/**
 * Compaction orchestration helpers extracted from AgentSession.
 *
 * Pure helper functions for compaction-related checks. The actual compaction
 * flow remains in AgentSession since it requires extensive internal state.
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import { isContextOverflow } from "@mariozechner/pi-ai";

/**
 * Check if an assistant message represents a context overflow error.
 */
export function isOverflowError(message: AssistantMessage): boolean {
	if (message.stopReason !== "error") return false;
	return isContextOverflow(message);
}

/**
 * Extract text content from an assistant message's content blocks.
 */
export function getAssistantMessageText(message: AssistantMessage): string {
	if (!message.content) return "";
	return message.content
		.filter((c) => c.type === "text")
		.map((c) => (c as { text: string }).text)
		.join("");
}

/**
 * Check if an assistant message indicates a retryable error
 * (overloaded, rate limit, server errors).
 */
export function isRetryableError(message: AssistantMessage): boolean {
	if (message.stopReason !== "error") return false;
	const text = getAssistantMessageText(message);
	if (!text) return false;

	const retryablePatterns = [/overloaded/i, /rate.?limit/i, /529/, /503/, /502/, /500/, /too many requests/i];
	return retryablePatterns.some((p) => p.test(text));
}
