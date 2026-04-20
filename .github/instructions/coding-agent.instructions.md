---
description: "Use when editing packages/coding-agent, the pi CLI, sessions, compaction, extensions, RPC, prompt templates, keybindings, or tools. Covers config path resolution, mode boundaries, keybinding rules, and the docs that define expected behavior."
name: "PI Coding Agent Package"
applyTo: "packages/coding-agent/**"
---

# packages/coding-agent Guidelines

- Start with [packages/coding-agent/README.md](../../packages/coding-agent/README.md), then use focused docs in [packages/coding-agent/docs/](../../packages/coding-agent/docs/) instead of rediscovering behavior: `development.md`, `extensions.md`, `session.md`, `compaction.md`, `rpc.md`, `skills.md`, and `packages.md`.
- Route changes by boundary: `src/cli.ts` and `src/main.ts` for startup and mode selection, `src/core/agent-session.ts` for shared session behavior, `src/core/tools/` for tool definitions, `src/core/extensions/` for extensibility, and `src/modes/` for mode-specific I/O.
- Resolve runtime assets through `src/config.ts` helpers; do not use `__dirname` for package assets.
- New keyboard shortcuts must go through the keybinding system with namespaced ids; do not hard-code `matchesKey(..., "ctrl+x")` checks.
- `./pi-test.sh` is the source-run entrypoint. Default agent state lives under `~/.pi/agent`; use `PI_CODING_AGENT_DIR` when you need isolated local state.
- For `packages/coding-agent/test/suite`, keep regressions offline and deterministic by using `test/suite/harness.ts` with the faux provider from `packages/ai/src/providers/faux.ts`.
