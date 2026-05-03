import type { AgentEvent } from "../types.js";
import type { MutableAgentState } from "./agent-state.js";

/**
 * Applies a loop event to runtime state before subscribers observe it.
 *
 * This preserves the public contract that `Agent.subscribe()` sees the state as
 * it exists at that event boundary.
 */
export function applyAgentEventToState(state: MutableAgentState, event: AgentEvent): void {
	switch (event.type) {
		case "message_start":
		case "message_update":
			state.streamingMessage = event.message;
			break;

		case "message_end":
			state.streamingMessage = undefined;
			state.messages.push(event.message);
			break;

		case "tool_execution_start": {
			const pendingToolCalls = new Set(state.pendingToolCalls);
			pendingToolCalls.add(event.toolCallId);
			state.pendingToolCalls = pendingToolCalls;
			break;
		}

		case "tool_execution_end": {
			const pendingToolCalls = new Set(state.pendingToolCalls);
			pendingToolCalls.delete(event.toolCallId);
			state.pendingToolCalls = pendingToolCalls;
			break;
		}

		case "turn_end":
			if (event.message.role === "assistant" && event.message.errorMessage) {
				state.errorMessage = event.message.errorMessage;
			}
			break;

		case "agent_end":
			state.streamingMessage = undefined;
			break;
	}
}

/** Awaits event listeners in registration order using the active run signal. */
export async function emitAgentEventToListeners(
	listeners: Iterable<(event: AgentEvent, signal: AbortSignal) => Promise<void> | void>,
	event: AgentEvent,
	signal: AbortSignal | undefined,
): Promise<void> {
	if (!signal) {
		throw new Error("Agent listener invoked outside active run");
	}

	for (const listener of listeners) {
		await listener(event, signal);
	}
}
