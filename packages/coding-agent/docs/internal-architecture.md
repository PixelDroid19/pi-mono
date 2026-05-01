# Internal Architecture

This document defines the internal ownership boundaries for `packages/coding-agent`. It is for maintainers who are changing runtime behavior, session persistence, extension wiring, or the interactive TUI. Public import paths stay stable; implementation detail moves behind internal modules.

## Stable Facades

These files are stable import paths. Do not remove or rename their exports without an explicit migration plan.

| Facade | Role |
|--------|------|
| `src/index.ts` | SDK public surface for external consumers |
| `src/core/index.ts` | Core abstractions re-exported for SDK and modes |
| `src/core/agent-session.ts` | Public `AgentSession` import path; implementation delegates to `core/agent-session-internal/` |
| `src/core/session-manager.ts` | Public session records and `SessionManager` import path; implementation delegates to `core/session-manager-internal/` |
| `src/core/package-manager.ts` | Public package manager contracts and `DefaultPackageManager` import path; implementation delegates to `core/package-manager-internal/` |
| `src/modes/interactive/interactive-mode.ts` | Public `InteractiveMode` import path; implementation delegates to `modes/interactive/internal/` |
| `src/modes/index.ts` | Mode entry points (`InteractiveMode`, print mode, RPC mode) |

## Dependency Rules

Dependency direction flows inward and downward:

```text
src/main.ts
  -> src/cli/startup/*
  -> src/modes/*
       -> src/core/*
            -> src/utils/*
```

Rules:
- `src/main.ts` is the CLI entry point. Nothing inside `src/` may import from `src/main.ts`.
- `src/modes/*` may depend on `src/core/*`; `src/core/*` must not depend on `src/modes/*` except renderer callback types already isolated behind tool render contracts.
- Public barrels (`src/index.ts`, `src/core/index.ts`, `src/modes/index.ts`) are for external consumers. Internal modules should import concrete files.
- Internal barrels may only re-export files from the same internal boundary.
- Do not introduce inline imports in production code. Lazy provider loading must use explicit top-level helper abstractions and documented ownership.

## Current Internal Boundaries

### Agent session

`core/agent-session.ts` is a facade. The implementation lives in `core/agent-session-internal/agent-session.ts` and delegates behavior to focused modules:

- `prompt-queue.ts`: prompt submission, extension commands, skill expansion, steering and follow-up queues.
- `session-events.ts`: agent event persistence, extension event forwarding, retry lifecycle, and queue draining.
- `model-state.ts`: model selection, scoped model cycling, thinking levels, and system prompt rebuilds.
- `reload.ts`: extension binding, runtime rebuild, tool registry refresh, and resource reload.
- `session-compaction.ts`, `tree-navigation.ts`, `session-export.ts`, `bash-execution.ts`: isolated session operations with observable side effects.

### Session manager

`core/session-manager.ts` is the stable public import path. Internals are split by responsibility:

- `session-manager-internal/records.ts`: entry types, migrations, JSONL parsing, context building, session listing helpers, and default session directory resolution.
- `session-manager-internal/session-manager.ts`: append-only persistence, leaf movement, labels, branch creation, import/open/fork factory methods, and list orchestration.

Session files are append-only JSONL trees. Any helper that changes `leafId`, writes entries, rewrites files, or migrates records must document the state transition it owns.

### Package manager

`core/package-manager.ts` is the stable public import path. Internals are split by responsibility:

- `package-manager-internal/resource-discovery.ts`: resource types, filter patterns, manifests, auto-discovery, precedence, and environment helpers.
- `package-manager-internal/default-package-manager.ts`: install/remove/update orchestration for npm, git, local sources, and resource aggregation.

Resource discovery must remain deterministic: project resources outrank user resources, explicit settings outrank auto-discovery, and package resources have the lowest precedence.

### Interactive mode

`modes/interactive/interactive-mode.ts` is the stable public import path. The implementation lives in `modes/interactive/internal/interactive-mode-impl.ts` and delegates to controllers:

- `interactive-runner.ts`: startup checks, initial prompts, and the blocking user-input loop.
- `interactive-mode-state.ts`: long-lived TUI objects, session accessors, and compatibility adapters shared by controller targets.
- `interactive-mode-options.ts`: startup-only inputs captured by the CLI before the TUI lifecycle begins.
- `interactive-startup.ts`: TUI initialization, autocomplete setup, startup notices, and first render.
- `session-runtime-controller.ts`: session replacement, extension rebinding, runtime settings, and fatal runtime errors.
- `session-view-controller.ts`: chat reconstruction, status rendering, message history population, and tool result rendering.
- `session-event-renderer.ts`: live agent event rendering.
- `extension-ui-controller.ts`: extension-owned selectors, dialogs, custom editor surfaces, widgets, headers, footers, and terminal input listeners.
- `submit-handler.ts` and `key-handler-controller.ts`: command dispatch and configurable keybindings.

Interactive helpers receive narrow target interfaces instead of the concrete class. Add methods to those interfaces only when the helper actually needs the state or callback.

## JSDoc Policy

Use JSDoc for contracts that affect other developers:

- Public exports and stable internal target interfaces.
- Helpers that mutate session state, files, process state, terminal state, extension bindings, or runtime registries.
- Non-obvious invariants such as append-only JSONL ordering, resource precedence, retry ordering, and extension reload ownership.

Do not add comments that restate a variable name or describe a trivial assignment. Documentation should explain ownership, side effects, inputs that must already be normalized, and observable behavior.

## Validation Gates

Refactors must preserve behavior and pass the relevant gates:

- `npm run check` from the repo root after code changes.
- `npm run check:lint:oxc` or `npx oxlint <touched-files>` for a non-mutating lint pass.
- Specific Vitest files from `packages/coding-agent` when tests are added or modified.
- TUI smoke with `./pi-test.sh` when interactive mode startup, rendering, key handling, or submit dispatch changes.

`npm run dev`, `npm run build`, and `npm test` are intentionally not part of this workflow unless explicitly requested.
