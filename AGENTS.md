# Repo Notes

## Structure

- npm workspaces monorepo. The main app is `packages/coding-agent` (`pi` CLI/TUI, entry `src/cli.ts`).
- Supporting packages: `packages/ai` (provider/model layer), `packages/agent` (agent runtime), `packages/tui` (terminal UI), `packages/web-ui` (component library; runnable app is `packages/web-ui/example`), `packages/mom` (Slack bot), `packages/pods` (GPU pod CLI).

## Read First

- Start with [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md), then read the README for the package you are changing.
- Core package references: [packages/ai/README.md](packages/ai/README.md), [packages/agent/README.md](packages/agent/README.md), [packages/coding-agent/README.md](packages/coding-agent/README.md).
- For `packages/coding-agent`, prefer focused docs over rediscovering behavior: [packages/coding-agent/docs/development.md](packages/coding-agent/docs/development.md), [packages/coding-agent/docs/extensions.md](packages/coding-agent/docs/extensions.md), [packages/coding-agent/docs/session.md](packages/coding-agent/docs/session.md), [packages/coding-agent/docs/compaction.md](packages/coding-agent/docs/compaction.md), [packages/coding-agent/docs/rpc.md](packages/coding-agent/docs/rpc.md), [packages/coding-agent/docs/skills.md](packages/coding-agent/docs/skills.md), and [packages/coding-agent/docs/packages.md](packages/coding-agent/docs/packages.md).
- Use examples instead of inventing patterns: [packages/coding-agent/examples/README.md](packages/coding-agent/examples/README.md), [packages/coding-agent/examples/extensions/README.md](packages/coding-agent/examples/extensions/README.md), and [packages/coding-agent/examples/sdk/README.md](packages/coding-agent/examples/sdk/README.md).

## Change Routing

- Provider, model, OAuth, API-registry, and model-generation work belongs in `packages/ai`.
- Agent loop, message conversion, tool execution, and steering/follow-up behavior belong in `packages/agent`.
- CLI startup, sessions, compaction, extensions, prompt templates, keybindings, and RPC belong in `packages/coding-agent`.
- Terminal rendering belongs in `packages/tui`.
- Browser UI belongs in `packages/web-ui`; the runnable app is `packages/web-ui/example`.

## Communication

- Keep prose short and technical. No emojis in code, commits, issues, or PR comments.

## Commands

- Use Node 22 to match CI. Package engines allow `>=20`.
- Install with `npm install`.
- Build before checks: `npm run build` then `npm run check`.
- `npm run check` mutates files. It runs `biome check --write`, `tsgo --noEmit`, `npm run check:browser-smoke`, then `packages/web-ui`'s own check.
- Pre-commit runs `npm run check` and restages previously staged files if formatting changed.
- Safe full local test: `./test.sh`. It temporarily moves `~/.pi/agent/auth.json`, unsets provider credentials, sets `PI_NO_LOCAL_LLM=1`, then runs `npm test`.
- CI order is `npm ci && npm run build && npm run check && npm test`.
- Root `npm run dev` starts watchers for `ai`, `agent`, `coding-agent`, `mom`, `web-ui`, and `tui`; prefer package-specific commands unless you need the whole workspace.

## Focused Verification

- Run focused tests from the package root using that package's `npm test` script.
- For `packages/coding-agent/test/suite`, use `test/suite/harness.ts` plus the faux provider from `packages/ai/src/providers/faux.ts`. Keep these tests offline and deterministic.
- Put issue-specific regressions in `packages/coding-agent/test/suite/regressions/<issue>-<slug>.test.ts`.

## Local Run

- `./pi-test.sh` runs `packages/coding-agent/src/cli.ts` via `tsx` from source and preserves the caller's current working directory.
- Default coding-agent state lives under `~/.pi/agent` (`auth.json`, sessions, keybindings). Override with `PI_CODING_AGENT_DIR`.
- `packages/web-ui` is a library. The browser app is the Vite example in `packages/web-ui/example`.

## Gotchas

- Do not hand-edit `packages/ai/src/models.generated.ts`; `packages/ai/scripts/generate-models.ts` regenerates it during `npm run build`.
- Do not rewrite `packages/ai/src/env-api-keys.ts` to top-level `node:*` imports. Its Node-only dynamic imports are required for browser/Vite safety, and `npm run check:browser-smoke` exists to catch regressions.
- In `packages/coding-agent`, resolve package assets through `src/config.ts` helpers, not `__dirname`; the CLI runs from npm, standalone binary, and `tsx` from source.
- In `packages/coding-agent`, new shortcuts should use namespaced keybinding ids and the keybindings system, not hard-coded `matchesKey(..., "ctrl+x")` checks. User overrides live in `~/.pi/agent/keybindings.json`.
- Unless the task is explicit maintainer or release work, do not edit `packages/*/CHANGELOG.md`; `CONTRIBUTING.md` says maintainers add changelog entries.

## Git And GitHub

- This repo may be edited by multiple agents at once. Never use `git add .`, `git add -A`, `git stash`, `git reset --hard`, `git checkout .`, or `git clean -fd`.
- Stage and commit only the paths you changed. Run `git status` first.
- New contributor issues and PRs are auto-closed by `.github/workflows/issue-gate.yml` and `.github/workflows/pr-gate.yml`. `lgtmi` approves future issues; `lgtm` approves future issues and PRs.
- When filing issues, use the GitHub templates and add `pkg:*` labels for affected packages.
- When posting multi-line issue or PR comments with `gh`, write the body to a temp file and use `--body-file`.

## Adding Providers

- Adding a provider in `packages/ai` is cross-cutting. Update `packages/ai/src/types.ts`, the provider module, `packages/ai/package.json` exports, `packages/ai/src/index.ts`, lazy registration in `packages/ai/src/providers/register-builtins.ts`, env detection in `packages/ai/src/env-api-keys.ts`, and model generation in `packages/ai/scripts/generate-models.ts`.
- Also update coding-agent defaults and docs in `packages/coding-agent/src/core/model-resolver.ts`, `packages/coding-agent/src/cli/args.ts`, and `packages/coding-agent/README.md`, plus the shared provider test matrix under `packages/ai/test/`.

## Release

- Releases are lockstep across packages. `npm run release:patch` and `npm run release:minor` expect a clean worktree and handle version bumping, changelog roll-forward, publish, tags, and push.
