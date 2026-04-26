/**
 * Bash execution boundary for AgentSession.
 *
 * Bash commands can be run by the built-in UI path or delegated to extensions.
 * This module keeps command execution, result persistence, and deferred message
 * flushing in one place so prompt ordering remains stable during streaming.
 */

import type { Agent } from "@mariozechner/pi-agent-core";
import { type BashResult, executeBashWithOperations } from "../bash-executor.js";
import type { BashExecutionMessage } from "../messages.js";
import type { SessionManager } from "../session-manager.js";
import { type BashOperations, createLocalBashOperations } from "../tools/bash.js";

export interface AgentSessionBashTarget {
	agent: Agent;
	sessionManager: Pick<SessionManager, "appendMessage" | "getCwd">;
	_bashAbortController: AbortController | undefined;
	_pendingBashMessages: BashExecutionMessage[];
	isStreaming: boolean;
	settingsManager: {
		getShellCommandPrefix(): string | undefined;
		getShellPath(): string | undefined;
	};
	recordBashResult(command: string, result: BashResult, options?: { excludeFromContext?: boolean }): void;
}

/**
 * Execute a bash command and record the result in session history.
 */
export async function executeSessionBash(
	target: AgentSessionBashTarget,
	command: string,
	onChunk?: (chunk: string) => void,
	options?: { excludeFromContext?: boolean; operations?: BashOperations },
): Promise<BashResult> {
	target._bashAbortController = new AbortController();

	const prefix = target.settingsManager.getShellCommandPrefix();
	const shellPath = target.settingsManager.getShellPath();
	const resolvedCommand = prefix ? `${prefix}\n${command}` : command;

	try {
		const result = await executeBashWithOperations(
			resolvedCommand,
			target.sessionManager.getCwd(),
			options?.operations ?? createLocalBashOperations({ shellPath }),
			{
				onChunk,
				signal: target._bashAbortController.signal,
			},
		);

		target.recordBashResult(command, result, options);
		return result;
	} finally {
		target._bashAbortController = undefined;
	}
}

/**
 * Persist a bash result immediately or defer it until the active turn ends.
 */
export function recordSessionBashResult(
	target: AgentSessionBashTarget,
	command: string,
	result: BashResult,
	options?: { excludeFromContext?: boolean },
): void {
	const bashMessage: BashExecutionMessage = {
		role: "bashExecution",
		command,
		output: result.output,
		exitCode: result.exitCode,
		cancelled: result.cancelled,
		truncated: result.truncated,
		fullOutputPath: result.fullOutputPath,
		timestamp: Date.now(),
		excludeFromContext: options?.excludeFromContext,
	};

	if (target.isStreaming) {
		target._pendingBashMessages.push(bashMessage);
	} else {
		target.agent.state.messages.push(bashMessage);
		target.sessionManager.appendMessage(bashMessage);
	}
}

/**
 * Flush deferred bash messages after the active agent turn finishes.
 */
export function flushPendingBashMessages(target: AgentSessionBashTarget): void {
	if (target._pendingBashMessages.length === 0) return;

	for (const bashMessage of target._pendingBashMessages) {
		target.agent.state.messages.push(bashMessage);
		target.sessionManager.appendMessage(bashMessage);
	}

	target._pendingBashMessages = [];
}
