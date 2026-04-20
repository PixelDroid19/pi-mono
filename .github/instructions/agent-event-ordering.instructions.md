---
description: "Use when editing packages/agent, the agent loop, event ordering, turn_start, message_end, tool_execution, steering, follow-up, or streaming event semantics. Preserves event sequencing and the tests/docs that define it."
name: "PI Agent Event Ordering"
applyTo: "packages/agent/**"
---

# packages/agent Event Ordering

- Start with [packages/agent/README.md](../../packages/agent/README.md), then confirm behavior against [packages/agent/src/agent-loop.ts](../../packages/agent/src/agent-loop.ts), [packages/agent/src/agent.ts](../../packages/agent/src/agent.ts), [packages/agent/src/types.ts](../../packages/agent/src/types.ts), [packages/agent/test/agent-loop.test.ts](../../packages/agent/test/agent-loop.test.ts), and [packages/agent/test/e2e.test.ts](../../packages/agent/test/e2e.test.ts).
- Preserve turn semantics: a turn is one assistant response plus any tool calls/results. The first `turn_start` is emitted before prompt message events; later turns emit a new `turn_start` only when the loop continues.
- Preserve message semantics: `message_start` and `message_end` cover user, assistant, and `toolResult` messages; `message_update` is assistant-only and only during streaming.
- Keep assistant `message_end` as the barrier before tool preflight. `beforeToolCall` must observe state/context that already includes the completed assistant message that requested the tools.
- Preserve tool lifecycle ordering: `tool_execution_start` fires before validation/blocking, `beforeToolCall` runs after validated args, `afterToolCall` runs before `tool_execution_end`, and the emitted `toolResult` message follows `tool_execution_end`.
- Parallel tool execution may run concurrently, but final `tool_execution_end` and `toolResult` message ordering must stay in assistant source order.
- Steering messages are injected only after all tool calls from the current assistant turn finish. Follow-up messages are delivered only after the agent would otherwise stop.
- `agent_end` must remain the final emitted event for the run, but awaited subscribers still count toward settlement and `waitForIdle()`.
- If you intentionally change ordering semantics, update both the README event documentation and the affected tests in `packages/agent/test/` in the same change.
