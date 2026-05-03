import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { MutableAgentState } from "./agent-state.js";
import { EMPTY_USAGE } from "./agent-state.js";

export interface ActiveRun {
	promise: Promise<void>;
	resolve: () => void;
	abortController: AbortController;
}

export interface AgentRunLifecycleTarget {
	activeRun?: ActiveRun;
	_state: MutableAgentState;
}

/** Marks the start of an active run and returns the abort signal for that run. */
export function beginAgentRun(target: AgentRunLifecycleTarget): AbortSignal {
	if (target.activeRun) {
		throw new Error("Agent is already processing.");
	}

	const abortController = new AbortController();
	let resolvePromise = () => {};
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});

	target.activeRun = { promise, resolve: resolvePromise, abortController };
	target._state.isStreaming = true;
	target._state.streamingMessage = undefined;
	target._state.errorMessage = undefined;
	return abortController.signal;
}

/**
 * Synthesizes an assistant failure message when the low-level loop throws
 * before it can emit a normal terminal event sequence.
 */
export function createRunFailureMessage(state: MutableAgentState, error: unknown, aborted: boolean): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "" }],
		api: state.model.api,
		provider: state.model.provider,
		model: state.model.id,
		usage: EMPTY_USAGE,
		stopReason: aborted ? "aborted" : "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

/** Clears transient runtime state and resolves `waitForIdle()` subscribers. */
export function finishAgentRun(target: AgentRunLifecycleTarget): void {
	target._state.isStreaming = false;
	target._state.streamingMessage = undefined;
	target._state.pendingToolCalls = new Set<string>();
	target.activeRun?.resolve();
	target.activeRun = undefined;
}
