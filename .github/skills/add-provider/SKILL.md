---
name: add-provider
description: 'Add or update a built-in LLM provider in pi-mono. Use for packages/ai provider registration, model generation, auth/env wiring, shared tests, coding-agent defaults, and docs so provider work lands completely instead of partially.'
argument-hint: 'provider name, API family, auth mode, and whether this is a new built-in provider or an update to an existing one'
---

# Add Provider

Use this skill when the task is to add or update a built-in provider or provider-backed model flow that ships with this repo.

## When To Use

- Add a new provider to `packages/ai`.
- Add a new API family or auth path to an existing built-in provider.
- Add provider models that change generated metadata, defaults, tests, or user-facing docs.

Do not use this skill for project-local proxies or extension-only providers. For that path, prefer [packages/coding-agent/docs/custom-provider.md](../../../packages/coding-agent/docs/custom-provider.md).

## Read First

- [AGENTS.md](../../../AGENTS.md)
- [packages/ai/README.md](../../../packages/ai/README.md)
- [packages/coding-agent/README.md](../../../packages/coding-agent/README.md)
- [packages/coding-agent/docs/custom-provider.md](../../../packages/coding-agent/docs/custom-provider.md)

## Procedure

1. Decide whether the provider should be built-in or extension-based.
If proxying, custom endpoints, or org-local auth are enough, prefer the extension path instead of changing `packages/ai`.

2. Update the `packages/ai` contracts.
Touch `packages/ai/src/types.ts`, the provider module under `packages/ai/src/providers/`, `packages/ai/src/index.ts`, `packages/ai/package.json` exports, and `packages/ai/src/providers/register-builtins.ts`.

3. Wire auth and environment detection.
Update `packages/ai/src/env-api-keys.ts` and `packages/ai/src/oauth.ts` when the provider needs API-key discovery, OAuth, or token refresh behavior.

4. Update model generation instead of editing generated output.
Change [packages/ai/scripts/generate-models.ts](../../../packages/ai/scripts/generate-models.ts), then regenerate. Never hand-edit `packages/ai/src/models.generated.ts`.

5. Update downstream coding-agent integration.
Check `packages/coding-agent/src/core/model-resolver.ts`, `packages/coding-agent/src/cli/args.ts`, and any docs or defaults that expose provider selection to end users.

6. Update the shared test matrix.
Add or extend tests in `packages/ai/test/`, including stream behavior, abort, empty input, context overflow, token accounting, and `cross-provider-handoff.test.ts`. If the provider has multiple model families, add at least one handoff pair per family.

7. Update docs where users discover the provider.
At minimum, review `packages/ai/README.md` and `packages/coding-agent/README.md`. Add focused docs only when setup or behavior differs from existing providers.

8. Verify in the right order.
Run focused package tests first, then repo checks that catch cross-package fallout: `cd packages/ai && npm test`, then `npm run build`, then `npm run check`. Run targeted `packages/coding-agent` tests if defaults, auth, or provider selection changed.

## Non-Negotiables

- Keep provider registration lazy in `packages/ai/src/providers/register-builtins.ts`; do not add static eager imports there.
- Preserve browser safety in `packages/ai/src/env-api-keys.ts`; do not move Node-only imports to the top level.
- Treat provider work as cross-cutting. A provider change is incomplete if generated models, env/auth detection, coding-agent defaults, tests, and docs are not reviewed together.
- If the request is only about adding custom runtime models for one installation, redirect to the extension-based provider path instead of hard-coding them into the built-in registry.
