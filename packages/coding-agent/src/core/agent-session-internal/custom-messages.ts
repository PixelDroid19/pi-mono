/**
 * Custom and extension-originated message delivery for AgentSession.
 *
 * Extensions can add custom context, queue steer/follow-up input, or trigger a
 * user turn. This module keeps those delivery modes aligned with Agent queueing
 * behavior while AgentSession keeps the public API surface.
 */

import type { Agent } from "@mariozechner/pi-agent-core";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import type { PromptOptions } from "../agent-session.js";
import type { CustomMessage } from "../messages.js";
import type { SessionManager } from "../session-manager.js";

export interface AgentSessionCustomMessageTarget {
	agent: Agent;
	sessionManager: Pick<SessionManager, "appendCustomMessageEntry">;
	_pendingNextTurnMessages: CustomMessage[];
	isStreaming: boolean;
	_emit(event: { type: "message_start" | "message_end"; message: CustomMessage }): void;
	prompt(text: string, options?: PromptOptions): Promise<void>;
}

/**
 * Deliver a custom message through the correct AgentSession queue.
 */
export async function sendSessionCustomMessage<T = unknown>(
	target: AgentSessionCustomMessageTarget,
	message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
	options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
): Promise<void> {
	const appMessage = {
		role: "custom" as const,
		customType: message.customType,
		content: message.content,
		display: message.display,
		details: message.details,
		timestamp: Date.now(),
	} satisfies CustomMessage<T>;
	if (options?.deliverAs === "nextTurn") {
		target._pendingNextTurnMessages.push(appMessage);
	} else if (target.isStreaming) {
		if (options?.deliverAs === "followUp") {
			target.agent.followUp(appMessage);
		} else {
			target.agent.steer(appMessage);
		}
	} else if (options?.triggerTurn) {
		await target.agent.prompt(appMessage);
	} else {
		target.agent.state.messages.push(appMessage);
		target.sessionManager.appendCustomMessageEntry(
			message.customType,
			message.content,
			message.display,
			message.details,
		);
		target._emit({ type: "message_start", message: appMessage });
		target._emit({ type: "message_end", message: appMessage });
	}
}

/**
 * Convert extension-provided content into a normal user prompt.
 */
export async function sendSessionUserMessage(
	target: AgentSessionCustomMessageTarget,
	content: string | (TextContent | ImageContent)[],
	options?: { deliverAs?: "steer" | "followUp" },
): Promise<void> {
	let text: string;
	let images: ImageContent[] | undefined;

	if (typeof content === "string") {
		text = content;
	} else {
		const textParts: string[] = [];
		images = [];
		for (const part of content) {
			if (part.type === "text") {
				textParts.push(part.text);
			} else {
				images.push(part);
			}
		}
		text = textParts.join("\n");
		if (images.length === 0) images = undefined;
	}

	await target.prompt(text, {
		expandPromptTemplates: false,
		streamingBehavior: options?.deliverAs,
		images,
		source: "extension",
	});
}
