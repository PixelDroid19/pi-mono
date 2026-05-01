/**
 * Public AgentSession facade.
 *
 * The implementation lives in agent-session-internal so session event handling,
 * prompt queues, reloads, compaction, model state, and export helpers can evolve
 * behind the stable SDK import path.
 */

export type {
	AgentSessionConfig,
	AgentSessionEvent,
	AgentSessionEventListener,
	ExtensionBindings,
	ModelCycleResult,
	ParsedSkillBlock,
	PromptOptions,
	SessionStats,
} from "./agent-session-contract.js";
export { parseSkillBlock } from "./agent-session-contract.js";
export { AgentSession } from "./agent-session-internal/agent-session.js";
