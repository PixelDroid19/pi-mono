import {
	type ImageContent,
	type Message,
	type SimpleStreamOptions,
	streamSimple,
	type ThinkingBudgets,
	type Transport,
} from "@mariozechner/pi-ai";
import { runAgentLoop, runAgentLoopContinue } from "./agent-loop.js";
import { applyAgentEventToState, emitAgentEventToListeners } from "./internal/agent-events.js";
import { PendingMessageQueue, type QueueMode } from "./internal/agent-queue.js";
import { type ActiveRun, beginAgentRun, createRunFailureMessage, finishAgentRun } from "./internal/agent-runner.js";
import { createContextSnapshot, createLoopConfig, normalizePromptInput } from "./internal/agent-runtime.js";
import { createMutableAgentState, type MutableAgentState } from "./internal/agent-state.js";
import type {
	AfterToolCallContext,
	AfterToolCallResult,
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentState,
	BeforeToolCallContext,
	BeforeToolCallResult,
	StreamFn,
	ToolExecutionMode,
} from "./types.js";

function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
	return messages.filter(
		(message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult",
	);
}

/** Options for constructing an {@link Agent}. */
export interface AgentOptions {
	/** Initial transcript, model, prompt, tools, and thinking state copied into the new agent. */
	initialState?: Partial<Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>;
	/**
	 * Converts application transcript messages into provider-compatible messages before each model call.
	 *
	 * The default converter passes through `user`, `assistant`, and `toolResult` messages.
	 * Applications with custom `AgentMessage` variants should filter or convert them here.
	 */
	convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
	/**
	 * Optional transcript-level transform applied before `convertToLlm`.
	 *
	 * Use this for pruning, compaction, or context injection that still needs app-level message types.
	 */
	transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
	/** Provider stream implementation. Defaults to `streamSimple` from `@mariozechner/pi-ai`. */
	streamFn?: StreamFn;
	/** Resolves credentials immediately before a model call, useful for expiring tokens. */
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	/** Raw provider payload observer forwarded to the stream function. */
	onPayload?: SimpleStreamOptions["onPayload"];
	/** Provider response observer forwarded to the stream function. */
	onResponse?: SimpleStreamOptions["onResponse"];
	/** Hook called after tool lookup and argument validation, before execution begins. */
	beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
	/** Hook called after execution and before final tool events and result messages are emitted. */
	afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
	/** Drain policy for messages queued with `steer()`. Defaults to `"one-at-a-time"`. */
	steeringMode?: QueueMode;
	/** Drain policy for messages queued with `followUp()`. Defaults to `"one-at-a-time"`. */
	followUpMode?: QueueMode;
	/** Session identifier forwarded to providers that support cache-aware sessions. */
	sessionId?: string;
	/** Optional per-reasoning-level token budgets forwarded to providers. */
	thinkingBudgets?: ThinkingBudgets;
	/** Preferred provider transport. Defaults to `"sse"`. */
	transport?: Transport;
	/** Optional cap for provider-requested retry delays. */
	maxRetryDelayMs?: number;
	/** Default execution mode for batches of assistant tool calls. Defaults to `"parallel"`. */
	toolExecution?: ToolExecutionMode;
}

/**
 * Stateful wrapper around the low-level agent loop.
 *
 * `Agent` owns the current transcript, emits lifecycle events, executes tools,
 * and exposes queueing APIs for steering and follow-up messages.
 *
 * Prefer this class for application code. It keeps event listeners, transcript
 * state, abort handling, queued messages, and run settlement in one place while
 * delegating model turns and tool execution to the lower-level loop modules.
 */
export class Agent {
	private _state: MutableAgentState;
	private readonly listeners = new Set<(event: AgentEvent, signal: AbortSignal) => Promise<void> | void>();
	private readonly steeringQueue: PendingMessageQueue;
	private readonly followUpQueue: PendingMessageQueue;

	public convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
	public transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
	public streamFn: StreamFn;
	public getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	public onPayload?: SimpleStreamOptions["onPayload"];
	public onResponse?: SimpleStreamOptions["onResponse"];
	public beforeToolCall?: AgentLoopConfig["beforeToolCall"];
	public afterToolCall?: AgentLoopConfig["afterToolCall"];
	private activeRun?: ActiveRun;
	/** Session identifier forwarded to providers for cache-aware backends. */
	public sessionId?: string;
	/** Optional per-level thinking token budgets forwarded to the stream function. */
	public thinkingBudgets?: ThinkingBudgets;
	/** Preferred transport forwarded to the stream function. */
	public transport: Transport;
	/** Optional cap for provider-requested retry delays. */
	public maxRetryDelayMs?: number;
	/** Tool execution strategy for assistant messages that contain multiple tool calls. */
	public toolExecution: ToolExecutionMode;

	constructor(options: AgentOptions = {}) {
		this._state = createMutableAgentState(options.initialState);
		this.convertToLlm = options.convertToLlm ?? defaultConvertToLlm;
		this.transformContext = options.transformContext;
		this.streamFn = options.streamFn ?? streamSimple;
		this.getApiKey = options.getApiKey;
		this.onPayload = options.onPayload;
		this.onResponse = options.onResponse;
		this.beforeToolCall = options.beforeToolCall;
		this.afterToolCall = options.afterToolCall;
		this.steeringQueue = new PendingMessageQueue(options.steeringMode ?? "one-at-a-time");
		this.followUpQueue = new PendingMessageQueue(options.followUpMode ?? "one-at-a-time");
		this.sessionId = options.sessionId;
		this.thinkingBudgets = options.thinkingBudgets;
		this.transport = options.transport ?? "sse";
		this.maxRetryDelayMs = options.maxRetryDelayMs;
		this.toolExecution = options.toolExecution ?? "parallel";
	}

	/**
	 * Subscribe to agent lifecycle events.
	 *
	 * Listener promises are awaited in subscription order and are included in
	 * the current run's settlement. Listeners also receive the active abort
	 * signal for the current run.
	 *
	 * `agent_end` is the final emitted event for a run, but the agent does not
	 * become idle until all awaited listeners for that event have settled.
	 */
	subscribe(listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Current agent state.
	 *
	 * Assigning `state.tools` or `state.messages` copies the provided top-level array.
	 */
	get state(): AgentState {
		return this._state;
	}

	/** Controls how queued steering messages are drained. */
	set steeringMode(mode: QueueMode) {
		this.steeringQueue.mode = mode;
	}

	get steeringMode(): QueueMode {
		return this.steeringQueue.mode;
	}

	/** Controls how queued follow-up messages are drained. */
	set followUpMode(mode: QueueMode) {
		this.followUpQueue.mode = mode;
	}

	get followUpMode(): QueueMode {
		return this.followUpQueue.mode;
	}

	/** Queue a message to be injected after the current assistant turn finishes. */
	steer(message: AgentMessage): void {
		this.steeringQueue.enqueue(message);
	}

	/** Queue a message to run only after the agent would otherwise stop. */
	followUp(message: AgentMessage): void {
		this.followUpQueue.enqueue(message);
	}

	/** Remove all queued steering messages. */
	clearSteeringQueue(): void {
		this.steeringQueue.clear();
	}

	/** Remove all queued follow-up messages. */
	clearFollowUpQueue(): void {
		this.followUpQueue.clear();
	}

	/** Remove all queued steering and follow-up messages. */
	clearAllQueues(): void {
		this.clearSteeringQueue();
		this.clearFollowUpQueue();
	}

	/** Returns true when either queue still contains pending messages. */
	hasQueuedMessages(): boolean {
		return this.steeringQueue.hasItems() || this.followUpQueue.hasItems();
	}

	/** Active abort signal for the current run, if any. */
	get signal(): AbortSignal | undefined {
		return this.activeRun?.abortController.signal;
	}

	/** Abort the current run, if one is active. */
	abort(): void {
		this.activeRun?.abortController.abort();
	}

	/**
	 * Resolve when the current run and all awaited event listeners have finished.
	 *
	 * This resolves after `agent_end` listeners settle.
	 */
	waitForIdle(): Promise<void> {
		return this.activeRun?.promise ?? Promise.resolve();
	}

	/** Clear transcript state, runtime state, and queued messages. */
	reset(): void {
		this._state.messages = [];
		this._state.isStreaming = false;
		this._state.streamingMessage = undefined;
		this._state.pendingToolCalls = new Set<string>();
		this._state.errorMessage = undefined;
		this.clearFollowUpQueue();
		this.clearSteeringQueue();
	}

	/** Start a new prompt from text, a single message, or a batch of messages. */
	async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
	async prompt(input: string, images?: ImageContent[]): Promise<void>;
	async prompt(input: string | AgentMessage | AgentMessage[], images?: ImageContent[]): Promise<void> {
		if (this.activeRun) {
			throw new Error(
				"Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
			);
		}
		const messages = normalizePromptInput(input, images);
		await this.runPromptMessages(messages);
	}

	/** Continue from the current transcript. The last message must be a user or tool-result message. */
	async continue(): Promise<void> {
		if (this.activeRun) {
			throw new Error("Agent is already processing. Wait for completion before continuing.");
		}

		const lastMessage = this._state.messages[this._state.messages.length - 1];
		if (!lastMessage) {
			throw new Error("No messages to continue from");
		}

		if (lastMessage.role === "assistant") {
			const queuedSteering = this.steeringQueue.drain();
			if (queuedSteering.length > 0) {
				await this.runPromptMessages(queuedSteering, { skipInitialSteeringPoll: true });
				return;
			}

			const queuedFollowUps = this.followUpQueue.drain();
			if (queuedFollowUps.length > 0) {
				await this.runPromptMessages(queuedFollowUps);
				return;
			}

			throw new Error("Cannot continue from message role: assistant");
		}

		await this.runContinuation();
	}

	private async runPromptMessages(
		messages: AgentMessage[],
		options: { skipInitialSteeringPoll?: boolean } = {},
	): Promise<void> {
		await this.runWithLifecycle(async (signal) => {
			await runAgentLoop(
				messages,
				this.createContextSnapshot(),
				this.createLoopConfig(options),
				(event) => this.processEvents(event),
				signal,
				this.streamFn,
			);
		});
	}

	private async runContinuation(): Promise<void> {
		await this.runWithLifecycle(async (signal) => {
			await runAgentLoopContinue(
				this.createContextSnapshot(),
				this.createLoopConfig(),
				(event) => this.processEvents(event),
				signal,
				this.streamFn,
			);
		});
	}

	private createContextSnapshot(): AgentContext {
		return createContextSnapshot(this._state);
	}

	private createLoopConfig(options: { skipInitialSteeringPoll?: boolean } = {}): AgentLoopConfig {
		return createLoopConfig(this as unknown as import("./internal/agent-runtime.js").AgentRuntimeSource, options);
	}

	private async runWithLifecycle(executor: (signal: AbortSignal) => Promise<void>): Promise<void> {
		const signal = beginAgentRun(this as unknown as import("./internal/agent-runner.js").AgentRunLifecycleTarget);
		try {
			await executor(signal);
		} catch (error) {
			await this.handleRunFailure(error, signal.aborted);
		} finally {
			finishAgentRun(this as unknown as import("./internal/agent-runner.js").AgentRunLifecycleTarget);
		}
	}

	private async handleRunFailure(error: unknown, aborted: boolean): Promise<void> {
		const failureMessage = createRunFailureMessage(this._state, error, aborted);
		this._state.messages.push(failureMessage);
		this._state.errorMessage = failureMessage.errorMessage;
		await this.processEvents({ type: "agent_end", messages: [failureMessage] });
	}

	/**
	 * Reduce internal state for a loop event, then await listeners.
	 *
	 * `agent_end` only means no further loop events will be emitted. The run is
	 * considered idle later, after all awaited listeners for `agent_end` finish
	 * and `finishRun()` clears runtime-owned state.
	 */
	private async processEvents(event: AgentEvent): Promise<void> {
		applyAgentEventToState(this._state, event);
		await emitAgentEventToListeners(this.listeners, event, this.activeRun?.abortController.signal);
	}
}
