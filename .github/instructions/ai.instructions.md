---
description: "Use when editing packages/ai, providers, models, api-registry, oauth, env-api-keys, or scripts/generate-models.ts. Covers generated files, browser safety, provider registration, and downstream follow-up files."
name: "PI AI Package"
applyTo: "packages/ai/**"
---

# packages/ai Guidelines

- Treat `packages/ai` as the provider/model abstraction layer. Read [packages/ai/README.md](../../packages/ai/README.md) before cross-cutting edits.
- Never hand-edit `packages/ai/src/models.generated.ts`; regenerate it through `packages/ai/scripts/generate-models.ts`.
- Keep `packages/ai/src/env-api-keys.ts` browser-safe. Do not replace its Node-only dynamic imports with top-level `node:*` imports.
- Provider additions are cross-cutting: update `src/types.ts`, the provider module, `src/index.ts`, `package.json` exports, `src/providers/register-builtins.ts`, `src/env-api-keys.ts`, `scripts/generate-models.ts`, and relevant tests under `packages/ai/test/`.
- Run focused verification from `packages/ai`: `npm test` for the package, then the repo-level `npm run build` and `npm run check` when the change affects shared contracts or generated models.
- If the change affects provider metadata or model availability, verify downstream defaults and docs in `packages/coding-agent` instead of stopping in `packages/ai`.
