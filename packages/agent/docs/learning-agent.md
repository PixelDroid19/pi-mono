# Learning `@mariozechner/pi-agent-core`

This guide is for developers who want to understand how to build an agent with this package and how the implementation is organized.

The package has one central idea: keep application state and lifecycle in `Agent`, and keep model calls and tool execution in the loop layer. That split lets applications use a simple stateful API while still allowing advanced callers to use the lower-level loop directly.

## Reading Path

Read the code in this order:

1. `src/types.ts`
   - Learn the public vocabulary: `AgentMessage`, `AgentState`, `AgentTool`, `AgentEvent`, and `AgentLoopConfig`.
   - This file explains the contracts that app code must obey.

2. `src/agent.ts`
   - Learn the high-level API used by most applications.
   - This class owns state, queues, event listeners, and run lifecycle.

3. `src/agent-loop.ts`
   - Learn the turn loop: prompt messages, assistant response, tools, steering, follow-up, and final `agent_end`.

4. `src/internal/assistant-response.ts`
   - Learn where `AgentMessage[]` becomes model-compatible `Message[]`.
   - This is the model boundary.

5. `src/internal/tool-execution.ts`
   - Learn the tool lifecycle: start event, validation, optional hooks, execution, final event, and tool result message.

6. `src/proxy.ts`
   - Learn how applications can route provider calls through their own backend while preserving the same stream contract.

## Build a Minimal Agent

An `Agent` needs a model, a system prompt, and optionally tools.

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";

const agent = new Agent({
	initialState: {
		systemPrompt: "You answer clearly and briefly.",
		model: getModel("openai", "gpt-4o-mini"),
		thinkingLevel: "off",
		tools: [],
	},
});

agent.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await agent.prompt("Explain what an agent loop is.");
```

What happens internally:

1. `prompt()` converts the string into a `user` message.
2. `Agent` creates a context snapshot from current state.
3. `runAgentLoop()` emits `agent_start`, `turn_start`, and message events for the user prompt.
4. `streamAssistantResponse()` calls the model and emits assistant streaming events.
5. `Agent` reduces each event back into `agent.state`.
6. `waitForIdle()` and `prompt()` resolve only after awaited listeners finish.

## Build an Agent from Scratch

This example shows the pieces most applications need: state, a typed tool, event subscription, `prompt()`, `steer()`, `followUp()`, and `continue()`.

```typescript
import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { Type } from "typebox";

const notesTool: AgentTool<
	typeof Type.Object({
		topic: Type.String(),
	}),
	{ topic: string; noteCount: number }
> = {
	name: "find_notes",
	label: "Find Notes",
	description: "Returns short local notes for a topic",
	parameters: Type.Object({
		topic: Type.String({ description: "Topic to search for" }),
	}),
	async execute(_toolCallId, params, signal, onUpdate) {
		if (signal?.aborted) {
			throw new Error("Search aborted");
		}

		onUpdate?.({
			content: [{ type: "text", text: `Searching notes for ${params.topic}` }],
			details: { topic: params.topic, noteCount: 0 },
		});

		return {
			content: [{ type: "text", text: `Found two notes about ${params.topic}.` }],
			details: { topic: params.topic, noteCount: 2 },
		};
	},
};

const agent = new Agent({
	initialState: {
		systemPrompt: "Use available tools before answering about local notes.",
		model: getModel("openai", "gpt-4o-mini"),
		thinkingLevel: "off",
		tools: [notesTool],
		messages: [],
	},
	toolExecution: "parallel",
});

agent.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
	if (event.type === "tool_execution_start") {
		console.log(`Running ${event.toolName}`);
	}
});

const firstRun = agent.prompt("Summarize my notes about release planning.");

agent.steer({
	role: "user",
	content: "Keep the summary focused on risks.",
	timestamp: Date.now(),
});

agent.followUp({
	role: "user",
	content: "After that, list three next actions.",
	timestamp: Date.now(),
});

await firstRun;

agent.state.messages.push({
	role: "user",
	content: "Now rewrite the last answer for a teammate.",
	timestamp: Date.now(),
});

await agent.continue();
```

The important behavior in this example is the ownership model:

- `Agent` owns the transcript and run lifecycle.
- the tool owns only its external operation and structured details.
- subscribers observe events and may persist or render them.
- `steer()` and `followUp()` queue new work without interrupting the current event.
- `continue()` resumes from existing transcript state.

## Add a Tool

Tools are the main way agents affect the outside world. A tool has a model-facing schema and a runtime `execute()` function.

```typescript
import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { Type } from "typebox";

const calculatorTool: AgentTool<
	typeof Type.Object({
		expression: Type.String(),
	}),
	{ expression: string; result: number }
> = {
	name: "calculate",
	label: "Calculate",
	description: "Evaluates a basic arithmetic expression",
	parameters: Type.Object({
		expression: Type.String({ description: "Arithmetic expression" }),
	}),
	async execute(_toolCallId, params) {
		const result = params.expression === "12 * 8" ? 96 : 0;
		return {
			content: [{ type: "text", text: `${params.expression} = ${result}` }],
			details: { expression: params.expression, result },
		};
	},
};

const agent = new Agent({
	initialState: {
		systemPrompt: "Use the calculator for arithmetic.",
		model: getModel("openai", "gpt-4o-mini"),
		tools: [calculatorTool],
	},
});

await agent.prompt("What is 12 * 8?");
```

Tool execution is intentionally split into phases:

- `tool_execution_start` is emitted before validation and hooks.
- `prepareArguments` may adapt raw model arguments before schema validation.
- `beforeToolCall` may block the call after validation.
- `execute()` performs the side effect or computation.
- `afterToolCall` may replace result fields or set `terminate`.
- `tool_execution_end` and the `toolResult` message are emitted after finalization.

This design lets UI code show pending tool work early, while runtime hooks still have a stable place to approve, block, or postprocess the call.

## Understand Messages

The package distinguishes app messages from model messages.

`AgentMessage` is the application transcript. It may include custom message types through declaration merging.

`Message` is the provider transcript. Providers only understand standard model roles such as `user`, `assistant`, and `toolResult`.

That is why `convertToLlm()` exists.

```typescript
declare module "@mariozechner/pi-agent-core" {
	interface CustomAgentMessages {
		notification: { role: "notification"; text: string; timestamp: number };
	}
}

const agent = new Agent({
	convertToLlm: (messages) =>
		messages.flatMap((message) => {
			if (message.role === "notification") {
				return [];
			}
			return [message];
		}),
});
```

Use `transformContext()` before `convertToLlm()` when the operation still needs application-level message information, for example pruning, compaction, or injecting external context.

## Understand the Loop

A normal prompt without tools has this shape:

```text
prompt()
agent_start
turn_start
message_start user
message_end user
message_start assistant
message_update assistant
message_end assistant
turn_end
agent_end
```

With tools, one assistant turn can cause another model call:

```text
message_end assistant with toolCall
tool_execution_start
tool_execution_end
message_start toolResult
message_end toolResult
turn_end
turn_start
message_start assistant
message_end assistant
turn_end
agent_end
```

The loop continues while any of these are true:

- the last assistant response requested tools
- steering messages were queued with `steer()`
- follow-up messages were queued with `followUp()`

## Execution Map

Use this map when debugging or changing behavior:

```text
Agent.prompt()
  -> normalizePromptInput()
  -> createContextSnapshot()
  -> createLoopConfig()
  -> runAgentLoop()
  -> streamAssistantResponse()
  -> executeToolCalls()
  -> getSteeringMessages()
  -> getFollowUpMessages()
  -> applyAgentEventToState()
  -> emitAgentEventToListeners()
```

The loop layer does not mutate public `AgentState` directly. It emits events. `Agent` applies those events to state before subscribers see them, which is why UI code can read current state inside a listener.

## Choose `Agent` or the Low-Level Loop

Use `Agent` for application code. It owns state, subscribers, abort handling, queues, and listener settlement.

Use `agentLoop()` only when you already own state elsewhere and want direct control over event consumption.

The important behavioral difference is listener settlement. `Agent.subscribe()` listeners are awaited before `prompt()` and `waitForIdle()` settle. A raw `agentLoop()` stream is a producer stream; consumers observe events but do not create the same state barrier.

## Source Map

The current implementation is split by responsibility:

- `src/agent.ts`: the public class. Keep public API decisions here. It delegates state mechanics and loop setup to focused internal helpers.
- `src/internal/agent-state.ts`: the mutable object behind `AgentState`. Change this only when public state shape or copy-on-assign behavior changes.
- `src/internal/agent-queue.ts`: steering and follow-up queue behavior. Change this when queue drain policy changes.
- `src/internal/agent-runtime.ts`: prompt normalization, context snapshots, and `AgentLoopConfig` creation. Change this when public `Agent` settings need to be forwarded to the loop differently.
- `src/internal/agent-events.ts`: event-to-state reduction and listener dispatch. Change this when event state effects change.
- `src/internal/agent-runner.ts`: active run setup, failure message creation, and cleanup. Change this when `isStreaming`, abort, or idle settlement behavior changes.
- `src/agent-loop.ts`: turn loop and public low-level stream helpers. Change this when the order of turns, steering, follow-up, or `agent_end` changes.
- `src/internal/assistant-response.ts`: provider streaming boundary. Change this when model stream events or partial assistant message handling changes.
- `src/internal/tool-execution.ts`: tool call preparation, validation, hooks, execution, and tool result messages. Change this when tool semantics change.
- `src/proxy.ts`: proxy transport adapter. Change this when the proxy wire format changes.

These internal modules are intentionally documented for maintainers. They are not stable import paths for applications.

## Where to Change Code

- Add a new public option: update `AgentOptions`, store it in `Agent`, forward it from `agent-runtime.ts`, and cover it in `agent.test.ts`.
- Change prompt or continuation behavior: update `agent.ts` if the public lifecycle changes, or `agent-loop.ts` if turn ordering changes.
- Change queue behavior: update `agent-queue.ts` and add tests for `steer()` or `followUp()`.
- Change state updates from events: update `agent-events.ts` and assert state inside a subscribed listener.
- Change tool behavior: update `tool-execution.ts` and add tests in `agent-loop.test.ts`.
- Change provider stream handling: update `assistant-response.ts` and test assistant event ordering.
- Change proxy behavior: update `proxy.ts` and keep the reconstructed `AssistantMessageEvent` contract intact.

## Common Mistakes

- Do not return error-looking text from a failed tool. Throw an error so the runtime marks the tool result as `isError: true`.
- Do not put UI-only custom messages into the provider transcript. Filter or convert them in `convertToLlm()`.
- Do not call `prompt()` while another prompt is active. Use `steer()` or `followUp()` for queued work.
- Do not use `continue()` after an assistant message unless queued steering or follow-up messages should be promoted into a new prompt.
- Do not mutate state during a run unless the surrounding app intentionally owns that behavior.

## What to Test When Changing This Package

Use the existing package tests as the learning checklist:

- `test/agent.test.ts`: state, subscribers, idle handling, abort, queue semantics.
- `test/agent-loop.test.ts`: low-level loop behavior and tool execution.
- `test/e2e.test.ts`: integration with the faux provider.

For behavior changes, add coverage near the behavior boundary instead of only testing the extracted helper.
