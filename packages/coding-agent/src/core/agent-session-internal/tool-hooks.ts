/**
 * Agent tool hook wiring for extension interception.
 *
 * The hooks read the current ExtensionRunner at execution time, so extension
 * reload can replace runners without reinstalling Agent callbacks.
 */

import type { Agent } from "@mariozechner/pi-agent-core";
import type { ExtensionRunner } from "../extensions/index.js";

export interface AgentSessionToolHookTarget {
	agent: Agent;
	_extensionRunner: ExtensionRunner;
	_agentEventQueue: Promise<void>;
}

/**
 * Install Agent-level tool call/result hooks once during session construction.
 */
export function installAgentToolHooks(target: AgentSessionToolHookTarget): void {
	target.agent.beforeToolCall = async ({ toolCall, args }) => {
		const runner = target._extensionRunner;
		if (!runner.hasHandlers("tool_call")) {
			return undefined;
		}

		await target._agentEventQueue;

		try {
			return await runner.emitToolCall({
				type: "tool_call",
				toolName: toolCall.name,
				toolCallId: toolCall.id,
				input: args as Record<string, unknown>,
			});
		} catch (err) {
			if (err instanceof Error) {
				throw err;
			}
			throw new Error(`Extension failed, blocking execution: ${String(err)}`);
		}
	};

	target.agent.afterToolCall = async ({ toolCall, args, result, isError }) => {
		const runner = target._extensionRunner;
		if (!runner.hasHandlers("tool_result")) {
			return undefined;
		}

		const hookResult = await runner.emitToolResult({
			type: "tool_result",
			toolName: toolCall.name,
			toolCallId: toolCall.id,
			input: args as Record<string, unknown>,
			content: result.content,
			details: result.details,
			isError,
		});

		if (!hookResult) {
			return undefined;
		}

		return {
			content: hookResult.content,
			details: hookResult.details,
			isError: hookResult.isError ?? isError,
		};
	};
}
