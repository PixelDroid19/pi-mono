import type {
	ImageContent,
	Message,
	SimpleStreamOptions,
	TextContent,
	ThinkingBudgets,
	Transport,
} from "@mariozechner/pi-ai";
import type {
	AfterToolCallContext,
	AfterToolCallResult,
	AgentContext,
	AgentLoopConfig,
	AgentMessage,
	BeforeToolCallContext,
	BeforeToolCallResult,
	ToolExecutionMode,
} from "../types.js";
import type { PendingMessageQueue } from "./agent-queue.js";
import type { MutableAgentState } from "./agent-state.js";

/**
 * Runtime inputs required to build a low-level loop configuration from the
 * current `Agent` instance.
 */
export interface AgentRuntimeSource {
	_state: MutableAgentState;
	sessionId?: string;
	onPayload?: SimpleStreamOptions["onPayload"];
	onResponse?: SimpleStreamOptions["onResponse"];
	transport: Transport;
	thinkingBudgets?: ThinkingBudgets;
	maxRetryDelayMs?: number;
	toolExecution: ToolExecutionMode;
	convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
	transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
	afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
	steeringQueue: PendingMessageQueue;
	followUpQueue: PendingMessageQueue;
}

/** Normalizes public `prompt()` input into agent messages stored in the transcript. */
export function normalizePromptInput(
	input: string | AgentMessage | AgentMessage[],
	images?: ImageContent[],
): AgentMessage[] {
	if (Array.isArray(input)) {
		return input;
	}

	if (typeof input !== "string") {
		return [input];
	}

	const content: Array<TextContent | ImageContent> = [{ type: "text", text: input }];
	if (images && images.length > 0) {
		content.push(...images);
	}
	return [{ role: "user", content, timestamp: Date.now() }];
}

/** Creates an isolated loop context so low-level execution cannot mutate live state directly. */
export function createContextSnapshot(state: MutableAgentState): AgentContext {
	return {
		systemPrompt: state.systemPrompt,
		messages: state.messages.slice(),
		tools: state.tools.slice(),
	};
}

/**
 * Builds the low-level loop config for the current run.
 *
 * `skipInitialSteeringPoll` is used by `continue()` when queued steering
 * messages are promoted into a new prompt batch before resuming the loop.
 * The returned callbacks close over the live queues so the loop can poll for
 * steering and follow-up work between turns without owning `Agent` state.
 */
export function createLoopConfig(
	source: AgentRuntimeSource,
	options: { skipInitialSteeringPoll?: boolean } = {},
): AgentLoopConfig {
	let skipInitialSteeringPoll = options.skipInitialSteeringPoll === true;

	return {
		model: source._state.model,
		reasoning: source._state.thinkingLevel === "off" ? undefined : source._state.thinkingLevel,
		sessionId: source.sessionId,
		onPayload: source.onPayload,
		onResponse: source.onResponse,
		transport: source.transport,
		thinkingBudgets: source.thinkingBudgets,
		maxRetryDelayMs: source.maxRetryDelayMs,
		toolExecution: source.toolExecution,
		beforeToolCall: source.beforeToolCall,
		afterToolCall: source.afterToolCall,
		convertToLlm: source.convertToLlm,
		transformContext: source.transformContext,
		getApiKey: source.getApiKey,
		getSteeringMessages: async () => {
			if (skipInitialSteeringPoll) {
				skipInitialSteeringPoll = false;
				return [];
			}
			return source.steeringQueue.drain();
		},
		getFollowUpMessages: async () => source.followUpQueue.drain(),
	};
}
