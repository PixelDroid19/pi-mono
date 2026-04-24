/**
 * Extension event bridge extracted from AgentSession.
 *
 * Maps AgentEvent types to extension event types and handles the
 * event forwarding protocol between the agent core and extension runner.
 */

import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type {
	ExtensionRunner,
	MessageEndEvent,
	MessageStartEvent,
	MessageUpdateEvent,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
	ToolExecutionUpdateEvent,
	TurnEndEvent,
	TurnStartEvent,
} from "../extensions/index.js";

/**
 * Forward an agent event to the extension runner.
 * Returns immediately if no extension runner is configured.
 */
export async function forwardAgentEventToExtensions(
	event: AgentEvent,
	extensionRunner: ExtensionRunner | undefined,
	turnIndex: number,
): Promise<number> {
	if (!extensionRunner) return turnIndex;

	let newTurnIndex = turnIndex;

	if (event.type === "agent_start") {
		newTurnIndex = 0;
		await extensionRunner.emit({ type: "agent_start" });
	} else if (event.type === "agent_end") {
		await extensionRunner.emit({ type: "agent_end", messages: event.messages });
	} else if (event.type === "turn_start") {
		const extensionEvent: TurnStartEvent = {
			type: "turn_start",
			turnIndex,
			timestamp: Date.now(),
		};
		await extensionRunner.emit(extensionEvent);
	} else if (event.type === "turn_end") {
		const extensionEvent: TurnEndEvent = {
			type: "turn_end",
			turnIndex,
			message: event.message,
			toolResults: event.toolResults,
		};
		await extensionRunner.emit(extensionEvent);
		newTurnIndex = turnIndex + 1;
	} else if (event.type === "message_start") {
		const extensionEvent: MessageStartEvent = {
			type: "message_start",
			message: event.message,
		};
		await extensionRunner.emit(extensionEvent);
	} else if (event.type === "message_update") {
		const extensionEvent: MessageUpdateEvent = {
			type: "message_update",
			message: event.message,
			assistantMessageEvent: event.assistantMessageEvent,
		};
		await extensionRunner.emit(extensionEvent);
	} else if (event.type === "message_end") {
		const extensionEvent: MessageEndEvent = {
			type: "message_end",
			message: event.message,
		};
		await extensionRunner.emit(extensionEvent);
	} else if (event.type === "tool_execution_start") {
		const extensionEvent: ToolExecutionStartEvent = {
			type: "tool_execution_start",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			args: event.args,
		};
		await extensionRunner.emit(extensionEvent);
	} else if (event.type === "tool_execution_update") {
		const extensionEvent: ToolExecutionUpdateEvent = {
			type: "tool_execution_update",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			args: event.args,
			partialResult: event.partialResult,
		};
		await extensionRunner.emit(extensionEvent);
	} else if (event.type === "tool_execution_end") {
		const extensionEvent: ToolExecutionEndEvent = {
			type: "tool_execution_end",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			result: event.result,
			isError: event.isError,
		};
		await extensionRunner.emit(extensionEvent);
	}

	return newTurnIndex;
}
