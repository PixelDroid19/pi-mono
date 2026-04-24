# Internal Architecture

This document describes the internal module boundaries, ownership rules, and placement guidance for `packages/coding-agent`. It is aimed at maintainers working on refactoring or extending internal logic.

## Stable Facades

The following files are **stable public entry points**. Their exports must not be removed or renamed without a migration path. Internal refactoring must happen behind these facades.

| Facade | Role |
|--------|------|
| `src/index.ts` | SDK public surface for external consumers |
| `src/core/index.ts` | Core abstractions re-exported for SDK and modes |
| `src/modes/index.ts` | Mode entry points (InteractiveMode, runPrintMode, runRpcMode) |

## One-Way Import Rules

Dependency direction flows **inward** and **downward**:

```
src/main.ts (CLI entry)
  -> src/cli/startup/*        (startup helpers)
  -> src/modes/*               (run modes)
       -> src/core/*           (core abstractions)
            -> src/utils/*     (pure utilities)
```

Rules:
- `src/main.ts` is the CLI entry point. Nothing inside `src/` may import from `src/main.ts`.
- `src/modes/*` may depend on `src/core/*` but never the reverse.
- `src/core/*` may depend on `src/utils/*` but never on `src/modes/*`.
- Nothing inside `src/` may import from `src/index.ts`, `src/core/index.ts`, or `src/modes/index.ts`. Barrels are for external consumers only.
- Internal barrels (e.g. `src/cli/startup/index.ts`) may only re-export from the same folder.

## Internal Helper Placement

When extracting logic from a hotspot file, use one of these patterns:

### Sibling `internal/` folder

For classes that remain as facades (e.g. `interactive-mode.ts`, `agent-session.ts`):

```
src/modes/interactive/
  interactive-mode.ts          # Facade class (stable surface)
  internal/
    bootstrap.ts               # Startup/init helpers
    commands.ts                # Slash-command handlers
    session-actions.ts         # Session management flows
```

### Sibling folder with a barrel

For orchestration files (e.g. `main.ts`):

```
src/cli/
  startup/
    index.ts                   # Local barrel, re-exports only from this folder
    app-mode.ts                # App mode resolution
    session-resolution.ts      # Session lookup and fork logic
    runtime-bootstrap.ts       # Runtime/service creation
    initial-message.ts         # Stdin and initial message prep
```

### Rules for new internal modules

1. Helpers receive **narrow context objects**, not broad class instances or facades.
2. New files are internal-only. Do not add them to any barrel that external consumers use.
3. Extract only when the logic is independently testable, reusable, or reduces hotspot size meaningfully. Do not over-extract.
4. Each extracted helper should have a single, clear responsibility.

## Extension Points

- **New slash commands**: Register in `src/core/slash-commands.ts` (built-in) or via the extension API.
- **New tools**: Add to `src/core/tools/` and register in `src/core/tools/index.ts`.
- **New keybindings**: Use namespaced keybinding IDs via the keybindings system. Never hard-code `matchesKey(..., "ctrl+x")`.
- **New prompt templates**: Add files to the prompt-templates directories (user, project, or CLI).
- **New themes**: Add to theme directories; use `src/modes/interactive/theme/theme.ts` APIs.

## Regression Baseline

The existing test suite under `test/` is the authoritative regression baseline. Refactoring must not require rewriting or modifying existing tests. New tests should only be added for currently uncovered pure helpers.

## Extraction Sequence

The recommended order for hotspot extraction follows a seam-first approach:

1. `src/main.ts` -- startup helpers are the easiest to isolate (pure functions, minimal state)
2. `src/modes/interactive/interactive-mode.ts` -- already has component seams via `components/`
3. `src/core/agent-session.ts` -- highest risk, should move after patterns are proven
4. Supporting managers (`resource-loader`, `session-manager`, `settings-manager`, `package-manager`) -- only if still justified after 1-3
