/**
 * Compaction orchestration boundary for AgentSession.
 *
 * Manual compaction, automatic threshold compaction, and context-overflow
 * recovery all mutate session history, agent context, extension hooks, and retry
 * scheduling. Keeping that sequence here lets AgentSession expose the same API
 * while making compaction behavior independently testable.
 */

import type { Agent } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Model } from "@mariozechner/pi-ai";
import { isContextOverflow } from "@mariozechner/pi-ai";
import type { AgentSessionEvent } from "../agent-session.js";
import { formatNoModelSelectedMessage } from "../auth-guidance.js";
import {
	type CompactionResult,
	calculateContextTokens,
	compact,
	estimateContextTokens,
	prepareCompaction,
	shouldCompact,
} from "../compaction/index.js";
import type { SessionBeforeCompactResult } from "../extensions/index.js";
import type { ExtensionRunner } from "../extensions/runner.js";
import type { ModelRegistry } from "../model-registry.js";
import type { CompactionEntry, SessionManager } from "../session-manager.js";
import { getLatestCompactionEntry } from "../session-manager.js";
import type { SettingsManager } from "../settings-manager.js";

export interface AgentSessionCompactionTarget {
	agent: Agent;
	sessionManager: Pick<SessionManager, "appendCompaction" | "buildSessionContext" | "getBranch" | "getEntries">;
	settingsManager: Pick<SettingsManager, "getCompactionSettings">;
	_modelRegistry: Pick<ModelRegistry, "getApiKeyAndHeaders">;
	_extensionRunner: Pick<ExtensionRunner, "emit" | "hasHandlers">;
	_compactionAbortController: AbortController | undefined;
	_autoCompactionAbortController: AbortController | undefined;
	_overflowRecoveryAttempted: boolean;
	model: Model<any> | undefined;
	thinkingLevel: Agent["state"]["thinkingLevel"];
	_disconnectFromAgent(): void;
	_reconnectToAgent(): void;
	abort(): Promise<void>;
	_emit(event: AgentSessionEvent): void;
	_getRequiredRequestAuth(model: Model<any>): Promise<{ apiKey: string; headers?: Record<string, string> }>;
}

/**
 * Run user-requested compaction and persist the resulting compaction entry.
 */
export async function compactSession(
	target: AgentSessionCompactionTarget,
	customInstructions?: string,
): Promise<CompactionResult> {
	target._disconnectFromAgent();
	await target.abort();
	target._compactionAbortController = new AbortController();
	target._emit({ type: "compaction_start", reason: "manual" });

	try {
		if (!target.model) {
			throw new Error(formatNoModelSelectedMessage());
		}

		const { apiKey, headers } = await target._getRequiredRequestAuth(target.model);

		const pathEntries = target.sessionManager.getBranch();
		const settings = target.settingsManager.getCompactionSettings();

		const preparation = prepareCompaction(pathEntries, settings);
		if (!preparation) {
			const lastEntry = pathEntries[pathEntries.length - 1];
			if (lastEntry?.type === "compaction") {
				throw new Error("Already compacted");
			}
			throw new Error("Nothing to compact (session too small)");
		}

		let extensionCompaction: CompactionResult | undefined;
		let fromExtension = false;

		if (target._extensionRunner.hasHandlers("session_before_compact")) {
			const result = (await target._extensionRunner.emit({
				type: "session_before_compact",
				preparation,
				branchEntries: pathEntries,
				customInstructions,
				signal: target._compactionAbortController.signal,
			})) as SessionBeforeCompactResult | undefined;

			if (result?.cancel) {
				throw new Error("Compaction cancelled");
			}

			if (result?.compaction) {
				extensionCompaction = result.compaction;
				fromExtension = true;
			}
		}

		const result = extensionCompaction
			? {
					summary: extensionCompaction.summary,
					firstKeptEntryId: extensionCompaction.firstKeptEntryId,
					tokensBefore: extensionCompaction.tokensBefore,
					details: extensionCompaction.details,
				}
			: await compact(
					preparation,
					target.model,
					apiKey,
					headers,
					customInstructions,
					target._compactionAbortController.signal,
					target.thinkingLevel,
				);

		if (target._compactionAbortController.signal.aborted) {
			throw new Error("Compaction cancelled");
		}

		await persistCompactionResult(target, result, fromExtension);
		target._emit({
			type: "compaction_end",
			reason: "manual",
			result,
			aborted: false,
			willRetry: false,
		});
		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const aborted = message === "Compaction cancelled" || (error instanceof Error && error.name === "AbortError");
		target._emit({
			type: "compaction_end",
			reason: "manual",
			result: undefined,
			aborted,
			willRetry: false,
			errorMessage: aborted ? undefined : `Compaction failed: ${message}`,
		});
		throw error;
	} finally {
		target._compactionAbortController = undefined;
		target._reconnectToAgent();
	}
}

/**
 * Check the last assistant response for overflow or threshold compaction.
 */
export async function checkSessionCompaction(
	target: AgentSessionCompactionTarget,
	assistantMessage: AssistantMessage,
	skipAbortedCheck = true,
): Promise<void> {
	const settings = target.settingsManager.getCompactionSettings();
	if (!settings.enabled) return;

	if (skipAbortedCheck && assistantMessage.stopReason === "aborted") return;

	const contextWindow = target.model?.contextWindow ?? 0;
	const sameModel =
		target.model && assistantMessage.provider === target.model.provider && assistantMessage.model === target.model.id;

	const compactionEntry = getLatestCompactionEntry(target.sessionManager.getBranch());
	const assistantIsFromBeforeCompaction =
		compactionEntry !== null && assistantMessage.timestamp <= new Date(compactionEntry.timestamp).getTime();
	if (assistantIsFromBeforeCompaction) {
		return;
	}

	if (sameModel && isContextOverflow(assistantMessage, contextWindow)) {
		if (target._overflowRecoveryAttempted) {
			target._emit({
				type: "compaction_end",
				reason: "overflow",
				result: undefined,
				aborted: false,
				willRetry: false,
				errorMessage:
					"Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.",
			});
			return;
		}

		target._overflowRecoveryAttempted = true;
		const messages = target.agent.state.messages;
		if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
			target.agent.state.messages = messages.slice(0, -1);
		}
		await runAutoCompaction(target, "overflow", true);
		return;
	}

	let contextTokens: number;
	if (assistantMessage.stopReason === "error") {
		const messages = target.agent.state.messages;
		const estimate = estimateContextTokens(messages);
		if (estimate.lastUsageIndex === null) return;
		const usageMsg = messages[estimate.lastUsageIndex];
		if (
			compactionEntry &&
			usageMsg.role === "assistant" &&
			(usageMsg as AssistantMessage).timestamp <= new Date(compactionEntry.timestamp).getTime()
		) {
			return;
		}
		contextTokens = estimate.tokens;
	} else {
		contextTokens = calculateContextTokens(assistantMessage.usage);
	}
	if (shouldCompact(contextTokens, contextWindow, settings)) {
		await runAutoCompaction(target, "threshold", false);
	}
}

/**
 * Run background compaction from overflow recovery or threshold checks.
 */
export async function runAutoCompaction(
	target: AgentSessionCompactionTarget,
	reason: "overflow" | "threshold",
	willRetry: boolean,
): Promise<void> {
	const settings = target.settingsManager.getCompactionSettings();

	target._emit({ type: "compaction_start", reason });
	target._autoCompactionAbortController = new AbortController();

	try {
		if (!target.model) {
			target._emit({ type: "compaction_end", reason, result: undefined, aborted: false, willRetry: false });
			return;
		}

		const authResult = await target._modelRegistry.getApiKeyAndHeaders(target.model);
		if (!authResult.ok || !authResult.apiKey) {
			target._emit({ type: "compaction_end", reason, result: undefined, aborted: false, willRetry: false });
			return;
		}
		const { apiKey, headers } = authResult;

		const pathEntries = target.sessionManager.getBranch();
		const preparation = prepareCompaction(pathEntries, settings);
		if (!preparation) {
			target._emit({ type: "compaction_end", reason, result: undefined, aborted: false, willRetry: false });
			return;
		}

		let extensionCompaction: CompactionResult | undefined;
		let fromExtension = false;

		if (target._extensionRunner.hasHandlers("session_before_compact")) {
			const extensionResult = (await target._extensionRunner.emit({
				type: "session_before_compact",
				preparation,
				branchEntries: pathEntries,
				customInstructions: undefined,
				signal: target._autoCompactionAbortController.signal,
			})) as SessionBeforeCompactResult | undefined;

			if (extensionResult?.cancel) {
				target._emit({ type: "compaction_end", reason, result: undefined, aborted: true, willRetry: false });
				return;
			}

			if (extensionResult?.compaction) {
				extensionCompaction = extensionResult.compaction;
				fromExtension = true;
			}
		}

		const result = extensionCompaction
			? {
					summary: extensionCompaction.summary,
					firstKeptEntryId: extensionCompaction.firstKeptEntryId,
					tokensBefore: extensionCompaction.tokensBefore,
					details: extensionCompaction.details,
				}
			: await compact(
					preparation,
					target.model,
					apiKey,
					headers,
					undefined,
					target._autoCompactionAbortController.signal,
					target.thinkingLevel,
				);

		if (target._autoCompactionAbortController.signal.aborted) {
			target._emit({ type: "compaction_end", reason, result: undefined, aborted: true, willRetry: false });
			return;
		}

		await persistCompactionResult(target, result, fromExtension);
		target._emit({ type: "compaction_end", reason, result, aborted: false, willRetry });

		if (willRetry) {
			const messages = target.agent.state.messages;
			const lastMsg = messages[messages.length - 1];
			if (lastMsg?.role === "assistant" && (lastMsg as AssistantMessage).stopReason === "error") {
				target.agent.state.messages = messages.slice(0, -1);
			}

			setTimeout(() => {
				target.agent.continue().catch(() => {});
			}, 100);
		} else if (target.agent.hasQueuedMessages()) {
			setTimeout(() => {
				target.agent.continue().catch(() => {});
			}, 100);
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "compaction failed";
		target._emit({
			type: "compaction_end",
			reason,
			result: undefined,
			aborted: false,
			willRetry: false,
			errorMessage:
				reason === "overflow"
					? `Context overflow recovery failed: ${errorMessage}`
					: `Auto-compaction failed: ${errorMessage}`,
		});
	} finally {
		target._autoCompactionAbortController = undefined;
	}
}

async function persistCompactionResult(
	target: AgentSessionCompactionTarget,
	result: CompactionResult,
	fromExtension: boolean,
): Promise<void> {
	target.sessionManager.appendCompaction(
		result.summary,
		result.firstKeptEntryId,
		result.tokensBefore,
		result.details,
		fromExtension,
	);
	const newEntries = target.sessionManager.getEntries();
	const sessionContext = target.sessionManager.buildSessionContext();
	target.agent.state.messages = sessionContext.messages;

	const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === result.summary) as
		| CompactionEntry
		| undefined;

	if (savedCompactionEntry) {
		await target._extensionRunner.emit({
			type: "session_compact",
			compactionEntry: savedCompactionEntry,
			fromExtension,
		});
	}
}
