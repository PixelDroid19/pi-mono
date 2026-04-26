/**
 * Session tree navigation boundary for AgentSession.
 *
 * Navigating within a branched session can optionally summarize abandoned work,
 * invoke extension hooks, relabel entries, and rewrite the active agent context.
 * The public AgentSession method delegates here so those side effects stay in a
 * single ordered sequence.
 */

import type { Agent } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import { collectEntriesForBranchSummary, generateBranchSummary } from "../compaction/index.js";
import type { ExtensionRunner, SessionBeforeTreeResult, TreePreparation } from "../extensions/index.js";
import type { BranchSummaryEntry, SessionManager } from "../session-manager.js";
import type { SettingsManager } from "../settings-manager.js";

export interface AgentSessionTreeTarget {
	agent: Agent;
	sessionManager: SessionManager;
	settingsManager: Pick<SettingsManager, "getBranchSummarySettings">;
	_extensionRunner: Pick<ExtensionRunner, "emit" | "hasHandlers">;
	_branchSummaryAbortController: AbortController | undefined;
	model: Model<any> | undefined;
	_getRequiredRequestAuth(model: Model<any>): Promise<{ apiKey: string; headers?: Record<string, string> }>;
	_extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string;
}

export interface NavigateTreeOptions {
	summarize?: boolean;
	customInstructions?: string;
	replaceInstructions?: boolean;
	label?: string;
}

export interface NavigateTreeResult {
	editorText?: string;
	cancelled: boolean;
	aborted?: boolean;
	summaryEntry?: BranchSummaryEntry;
}

/**
 * Move the active session leaf to another entry, optionally summarizing the
 * abandoned branch before switching context.
 */
export async function navigateSessionTree(
	target: AgentSessionTreeTarget,
	targetId: string,
	options: NavigateTreeOptions = {},
): Promise<NavigateTreeResult> {
	const oldLeafId = target.sessionManager.getLeafId();

	if (targetId === oldLeafId) {
		return { cancelled: false };
	}

	if (options.summarize && !target.model) {
		throw new Error("No model available for summarization");
	}

	const targetEntry = target.sessionManager.getEntry(targetId);
	if (!targetEntry) {
		throw new Error(`Entry ${targetId} not found`);
	}

	const { entries: entriesToSummarize, commonAncestorId } = collectEntriesForBranchSummary(
		target.sessionManager,
		oldLeafId,
		targetId,
	);

	let customInstructions = options.customInstructions;
	let replaceInstructions = options.replaceInstructions;
	let label = options.label;

	const preparation: TreePreparation = {
		targetId,
		oldLeafId,
		commonAncestorId,
		entriesToSummarize,
		userWantsSummary: options.summarize ?? false,
		customInstructions,
		replaceInstructions,
		label,
	};

	target._branchSummaryAbortController = new AbortController();

	try {
		let extensionSummary: { summary: string; details?: unknown } | undefined;
		let fromExtension = false;

		if (target._extensionRunner.hasHandlers("session_before_tree")) {
			const result = (await target._extensionRunner.emit({
				type: "session_before_tree",
				preparation,
				signal: target._branchSummaryAbortController.signal,
			})) as SessionBeforeTreeResult | undefined;

			if (result?.cancel) {
				return { cancelled: true };
			}

			if (result?.summary && options.summarize) {
				extensionSummary = result.summary;
				fromExtension = true;
			}

			if (result?.customInstructions !== undefined) {
				customInstructions = result.customInstructions;
			}
			if (result?.replaceInstructions !== undefined) {
				replaceInstructions = result.replaceInstructions;
			}
			if (result?.label !== undefined) {
				label = result.label;
			}
		}

		let summaryText: string | undefined;
		let summaryDetails: unknown;
		if (options.summarize && entriesToSummarize.length > 0 && !extensionSummary) {
			const model = target.model!;
			const { apiKey, headers } = await target._getRequiredRequestAuth(model);
			const branchSummarySettings = target.settingsManager.getBranchSummarySettings();
			const result = await generateBranchSummary(entriesToSummarize, {
				model,
				apiKey,
				headers,
				signal: target._branchSummaryAbortController.signal,
				customInstructions,
				replaceInstructions,
				reserveTokens: branchSummarySettings.reserveTokens,
			});
			if (result.aborted) {
				return { cancelled: true, aborted: true };
			}
			if (result.error) {
				throw new Error(result.error);
			}
			summaryText = result.summary;
			summaryDetails = {
				readFiles: result.readFiles || [],
				modifiedFiles: result.modifiedFiles || [],
			};
		} else if (extensionSummary) {
			summaryText = extensionSummary.summary;
			summaryDetails = extensionSummary.details;
		}

		let newLeafId: string | null;
		let editorText: string | undefined;

		if (targetEntry.type === "message" && targetEntry.message.role === "user") {
			newLeafId = targetEntry.parentId;
			editorText = target._extractUserMessageText(targetEntry.message.content);
		} else if (targetEntry.type === "custom_message") {
			newLeafId = targetEntry.parentId;
			editorText =
				typeof targetEntry.content === "string"
					? targetEntry.content
					: targetEntry.content
							.filter((c): c is { type: "text"; text: string } => c.type === "text")
							.map((c) => c.text)
							.join("");
		} else {
			newLeafId = targetId;
		}

		let summaryEntry: BranchSummaryEntry | undefined;
		if (summaryText) {
			const summaryId = target.sessionManager.branchWithSummary(
				newLeafId,
				summaryText,
				summaryDetails,
				fromExtension,
			);
			summaryEntry = target.sessionManager.getEntry(summaryId) as BranchSummaryEntry;

			if (label) {
				target.sessionManager.appendLabelChange(summaryId, label);
			}
		} else if (newLeafId === null) {
			target.sessionManager.resetLeaf();
		} else {
			target.sessionManager.branch(newLeafId);
		}

		if (label && !summaryText) {
			target.sessionManager.appendLabelChange(targetId, label);
		}

		const sessionContext = target.sessionManager.buildSessionContext();
		target.agent.state.messages = sessionContext.messages;

		await target._extensionRunner.emit({
			type: "session_tree",
			newLeafId: target.sessionManager.getLeafId(),
			oldLeafId,
			summaryEntry,
			fromExtension: summaryText ? fromExtension : undefined,
		});

		return { editorText, cancelled: false, summaryEntry };
	} finally {
		target._branchSummaryAbortController = undefined;
	}
}

/**
 * Collect user-authored session entries for fork selectors.
 */
export function getUserMessagesForSessionForking(
	target: Pick<AgentSessionTreeTarget, "sessionManager" | "_extractUserMessageText">,
): Array<{ entryId: string; text: string }> {
	const entries = target.sessionManager.getEntries();
	const result: Array<{ entryId: string; text: string }> = [];

	for (const entry of entries) {
		if (entry.type !== "message") continue;
		if (entry.message.role !== "user") continue;

		const text = target._extractUserMessageText(entry.message.content);
		if (text) {
			result.push({ entryId: entry.id, text });
		}
	}

	return result;
}

/**
 * Extract plain text from user/custom-message content blocks.
 */
export function extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");
	}
	return "";
}
