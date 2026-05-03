# @mariozechner/pi-agent-core

`@mariozechner/pi-agent-core` is the stateful runtime layer that sits on top of `@mariozechner/pi-ai`. It owns transcript state, tool execution, event streaming, steering queues, and the lifecycle rules around `prompt()`, `continue()`, and `waitForIdle()`.

Use this package when you need an agent that:

- keeps multi-turn state in memory
- executes typed tools and feeds results back to the model
- emits UI-friendly lifecycle events
- supports steering and queued follow-up work while a run is active

If you are new to the package, read this README first, then continue with
[Learning `@mariozechner/pi-agent-core`](./docs/learning-agent.md). The learning guide maps the public API to the source files so you can study how the runtime is built.

## Installation

```bash
npm install @mariozechner/pi-agent-core
```

## Mental Model

There are two layers:

1. `Agent`
   - high-level stateful API
   - owns the transcript and queueing primitives
   - awaits subscribed event handlers before the run is considered settled

2. `agentLoop()` / `runAgentLoop()`
   - low-level loop API
   - consumes a context snapshot plus configuration
   - emits the same event model, but does not add the extra state barrier that `Agent` provides

The core message pipeline is:

```text
AgentMessage[] -> transformContext() -> convertToLlm() -> provider stream
```

- `AgentMessage[]` is your application-facing transcript.
- `transformContext()` is optional and works at the app transcript level.
- `convertToLlm()` is the boundary adapter that produces model-compatible `Message[]`.

The implementation mirrors this model:

- `src/agent.ts` owns public state and lifecycle.
- `src/agent-loop.ts` owns turn control.
- `src/internal/assistant-response.ts` owns the provider stream boundary.
- `src/internal/tool-execution.ts` owns tool preparation, hooks, execution, and result messages.

## How to Study This Package

Start with the public API before reading internals:

1. Read `src/types.ts` to learn the vocabulary.
2. Read `src/agent.ts` to see how applications use the package.
3. Read `src/agent-loop.ts` to understand turn control.
4. Read `src/internal/assistant-response.ts` to find the provider boundary.
5. Read `src/internal/tool-execution.ts` to understand tool execution.
6. Read `docs/learning-agent.md` for a longer walkthrough that connects these files.

The internal modules are documented because they are useful for maintainers, but they are not public API. Application code should import from the package root.

## Quick Start

```typescript
import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { Type } from "typebox";

const weatherTool: AgentTool<
	typeof Type.Object({
		city: Type.String(),
	}),
	{ city: string; forecast: string }
> = {
	name: "get_weather",
	label: "Get Weather",
	description: "Returns a short weather summary for a city",
	parameters: Type.Object({
		city: Type.String({ description: "City name" }),
	}),
	async execute(_toolCallId, params) {
		const forecast = `Sunny in ${params.city}`;
		return {
			content: [{ type: "text", text: forecast }],
			details: { city: params.city, forecast },
		};
		},
	};

const agent = new Agent({
	initialState: {
		systemPrompt: "You are a concise assistant. Use tools when they help.",
		model: getModel("openai", "gpt-4o-mini"),
		thinkingLevel: "off",
		tools: [weatherTool],
	},
});

agent.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await agent.prompt("What is the weather in Bogota?");
```

Low-level loop callers can set `shouldStopAfterTurn` to stop gracefully after the current turn completes:

```typescript
const stream = agentLoop(prompts, context, {
	model,
	convertToLlm,
	shouldStopAfterTurn: async ({ context }) => {
		return shouldCompactBeforeNextTurn(context.messages);
	},
});
```

`shouldStopAfterTurn` runs after `turn_end` is emitted and after the assistant response and any tool executions have completed normally. If it returns `true`, the loop emits `agent_end` and exits before polling steering or follow-up queues, and before starting another LLM call. It does not abort the provider stream, does not cancel running tools, and does not alter the assistant message stop reason.

When you use the `Agent` class, assistant `message_end` processing is treated as a barrier before tool preflight begins. That means `beforeToolCall` sees agent state that already includes the assistant message that requested the tool call.

## Building an Agent

Use this sequence when creating a new agent:

1. Choose the model and system prompt.
2. Define tools with schemas and runtime implementations.
3. Decide whether the app transcript needs custom message types.
4. Subscribe to events for UI updates or persistence.
5. Call `prompt()`, then use `steer()` or `followUp()` for work that arrives while the run is active.

### 1. Pick a model and define the initial state

`Agent` reads its future runtime configuration from `agent.state`:

```typescript
const agent = new Agent({
	initialState: {
		systemPrompt: "You are a helpful assistant.",
		model: getModel("anthropic", "claude-sonnet-4-20250514"),
		thinkingLevel: "low",
		tools: [],
		messages: [],
	},
});
```

You can update `agent.state.systemPrompt`, `agent.state.model`, `agent.state.thinkingLevel`, and `agent.state.tools` between runs.

### 2. Define tools

Tools are regular `AgentTool` objects with a schema and an `execute()` implementation:

```typescript
import { Type } from "typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const readFileTool: AgentTool<
	typeof Type.Object({
		path: Type.String(),
	}),
	{ path: string; size: number }
> = {
	name: "read_file",
	label: "Read File",
	description: "Reads a file from disk",
	parameters: Type.Object({
		path: Type.String({ description: "Absolute file path" }),
	}),
	executionMode: "sequential",
	async execute(_toolCallId, params, _signal, onUpdate) {
		onUpdate?.({
			content: [{ type: "text", text: `Reading ${params.path}` }],
			details: { path: params.path, size: 0 },
		});

		const content = await fs.promises.readFile(params.path, "utf8");
		return {
			content: [{ type: "text", text: content }],
			details: { path: params.path, size: content.length },
		};
	},
};
```

Tool rules that matter:

- throw on failure instead of returning an error-looking text payload
- use `prepareArguments` only as a compatibility shim before schema validation
- use `executionMode: "sequential"` only for tools that cannot safely run concurrently
- return `terminate: true` only when you intentionally want to suppress the automatic post-tool assistant turn

### 3. Decide how your app transcript maps to model messages

If your transcript contains only standard `user`, `assistant`, and `toolResult` messages, the default conversion is enough.

If your app adds custom message types, implement `convertToLlm()`:

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

Add `transformContext()` when you need transcript-level pruning or context injection before the LLM call.

## Runtime Semantics

This section documents behavior that application code can rely on. The same
behavior is covered by `packages/agent/test/agent.test.ts`,
`packages/agent/test/agent-loop.test.ts`, and `packages/agent/test/e2e.test.ts`.

### Event ordering

A basic `prompt()` run emits:

```text
agent_start
turn_start
message_start   (user)
message_end     (user)
message_start   (assistant)
message_update  (assistant streaming)
message_end     (assistant)
turn_end
agent_end
```

If the assistant emits tool calls, the turn expands with:

```text
tool_execution_start
tool_execution_update
tool_execution_end
message_start   (toolResult)
message_end     (toolResult)
```

Important guarantees:

- `Agent.subscribe()` listeners are awaited in registration order.
- `agent_end` is the last event emitted by the loop.
- `await agent.prompt(...)` and `await agent.waitForIdle()` settle only after awaited `agent_end` listeners finish.
- In the `Agent` class, the assistant `message_end` event has already updated agent state before tool preflight hooks run.

### Steering and follow-up

- `steer()` queues messages that should be injected after the current turn finishes.
- `followUp()` queues messages that should run only when the agent would otherwise stop.
- Queue mode `"one-at-a-time"` drains one message per poll; `"all"` drains the full batch.

```typescript
agent.steer({
	role: "user",
	content: "Stop and summarize what you found so far.",
	timestamp: Date.now(),
});

agent.followUp({
	role: "user",
	content: "Now turn that summary into a checklist.",
	timestamp: Date.now(),
});
```

### `continue()`

`continue()` resumes from the current transcript without adding a new prompt. The last transcript message must be a `user` or `toolResult` message. If the last message is `assistant`, the method first prefers queued steering or follow-up work; otherwise it throws.

## State and Lifecycle API

`agent.state` is the public runtime state:

```typescript
agent.state.systemPrompt = "You are a careful reviewer.";
agent.state.model = getModel("google", "gemini-2.5-flash");
agent.state.thinkingLevel = "medium";
agent.state.tools = [readFileTool];
agent.state.messages = [];
```

State details that matter:

- assigning `agent.state.tools = [...]` or `agent.state.messages = [...]` copies the top-level array
- mutating the returned array mutates the live state
- `agent.state.streamingMessage` holds the current partial assistant message during streaming
- `agent.state.pendingToolCalls` contains tool call ids currently executing
- `agent.state.errorMessage` captures the latest failed or aborted assistant turn

Control surface:

```typescript
agent.abort();
await agent.waitForIdle();
agent.reset();
```

## Hooks and Advanced Configuration

`beforeToolCall` runs after tool lookup and argument validation. Use it to block or audit execution.

`afterToolCall` runs after tool execution and before final tool events and transcript artifacts are emitted. Use it to override `content`, `details`, `isError`, or `terminate`.

```typescript
const agent = new Agent({
	beforeToolCall: async ({ toolCall }) => {
		if (toolCall.name === "bash") {
			return { block: true, reason: "bash is disabled" };
		}
	},
	afterToolCall: async ({ toolCall, result, isError }) => {
		if (!isError && toolCall.name === "notify_done") {
			return { terminate: true, details: result.details };
		}
	},
	toolExecution: "parallel",
	sessionId: "session-123",
	transport: "sse",
	thinkingBudgets: {
		minimal: 128,
		low: 512,
		medium: 1024,
		high: 2048,
	},
});
```

## Proxy Usage

Use `streamProxy()` when your app must send model traffic through an application backend:

```typescript
import { Agent, streamProxy } from "@mariozechner/pi-agent-core";

const agent = new Agent({
	streamFn: (model, context, options) =>
		streamProxy(model, context, {
			...options,
			authToken: await getProxyToken(),
			proxyUrl: "https://genai.example.com",
		}),
});
```

The proxy transport preserves the standard `AssistantMessageEvent` shape by reconstructing the partial assistant message on the client.

## Low-Level Loop API

Use `agentLoop()` or `runAgentLoop()` when you want direct control over context snapshots and event consumption:

```typescript
import { agentLoop, type AgentContext, type AgentLoopConfig } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";

const context: AgentContext = {
	systemPrompt: "You are helpful.",
	messages: [],
	tools: [],
};

const config: AgentLoopConfig = {
	model: getModel("openai", "gpt-4o-mini"),
	convertToLlm: (messages) =>
		messages.filter(
			(message) =>
				message.role === "user" || message.role === "assistant" || message.role === "toolResult",
		),
};

for await (const event of agentLoop([{ role: "user", content: "Hello", timestamp: Date.now() }], context, config)) {
	console.log(event.type);
}
```

Use the low-level API when you need producer-side control. Use `Agent` when you want state ownership, queueing, and listener settlement barriers.

## Where to Change Code

- Change public state or lifecycle behavior in `src/agent.ts`.
- Change turn ordering, steering, or follow-up behavior in `src/agent-loop.ts`.
- Change provider streaming behavior in `src/internal/assistant-response.ts`.
- Change tool validation, hooks, execution, or result emission in `src/internal/tool-execution.ts`.
- Change proxy wire handling in `src/proxy.ts`.

When changing behavior, add or update the closest package test first. The existing tests are organized around the main responsibilities: `agent.test.ts` for public state and lifecycle, `agent-loop.test.ts` for loop behavior, and `e2e.test.ts` for full agent behavior with the faux provider.

## License

MIT
