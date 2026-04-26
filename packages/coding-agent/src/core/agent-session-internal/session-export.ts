/**
 * Session statistics and export boundary for AgentSession.
 *
 * These operations read the current branch and Agent state but do not alter the
 * active turn. Keeping them outside the facade keeps presentation/export logic
 * separate from prompt, model, and event state transitions.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AgentMessage, AgentState } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Model } from "@mariozechner/pi-ai";
import { theme } from "../../modes/interactive/theme/theme.js";
import type { SessionStats } from "../agent-session.js";
import { calculateContextTokens, estimateContextTokens } from "../compaction/index.js";
import { exportSessionToHtml, type ToolHtmlRenderer } from "../export-html/index.js";
import { createToolHtmlRenderer } from "../export-html/tool-renderer.js";
import type { ContextUsage, ToolDefinition } from "../extensions/index.js";
import type { SessionManager } from "../session-manager.js";
import { CURRENT_SESSION_VERSION, getLatestCompactionEntry, type SessionHeader } from "../session-manager.js";
import type { SettingsManager } from "../settings-manager.js";

export interface AgentSessionExportTarget {
	sessionManager: SessionManager;
	settingsManager: Pick<SettingsManager, "getTheme">;
	state: AgentState;
	messages: AgentMessage[];
	model: Model<any> | undefined;
	sessionFile: string | undefined;
	sessionId: string;
	getContextUsage(): ContextUsage | undefined;
	getToolDefinition(name: string): ToolDefinition | undefined;
}

/**
 * Calculate message, token, cost, and context metrics for `/session`.
 */
export function getSessionStats(target: AgentSessionExportTarget): SessionStats {
	const state = target.state;
	const userMessages = state.messages.filter((m) => m.role === "user").length;
	const assistantMessages = state.messages.filter((m) => m.role === "assistant").length;
	const toolResults = state.messages.filter((m) => m.role === "toolResult").length;

	let toolCalls = 0;
	let totalInput = 0;
	let totalOutput = 0;
	let totalCacheRead = 0;
	let totalCacheWrite = 0;
	let totalCost = 0;

	for (const message of state.messages) {
		if (message.role === "assistant") {
			const assistantMsg = message as AssistantMessage;
			toolCalls += assistantMsg.content.filter((c) => c.type === "toolCall").length;
			totalInput += assistantMsg.usage.input;
			totalOutput += assistantMsg.usage.output;
			totalCacheRead += assistantMsg.usage.cacheRead;
			totalCacheWrite += assistantMsg.usage.cacheWrite;
			totalCost += assistantMsg.usage.cost.total;
		}
	}

	return {
		sessionFile: target.sessionFile,
		sessionId: target.sessionId,
		userMessages,
		assistantMessages,
		toolCalls,
		toolResults,
		totalMessages: state.messages.length,
		tokens: {
			input: totalInput,
			output: totalOutput,
			cacheRead: totalCacheRead,
			cacheWrite: totalCacheWrite,
			total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
		},
		cost: totalCost,
		contextUsage: target.getContextUsage(),
	};
}

/**
 * Estimate current context usage while respecting compaction boundaries.
 */
export function getSessionContextUsage(target: AgentSessionExportTarget): ContextUsage | undefined {
	const model = target.model;
	if (!model) return undefined;

	const contextWindow = model.contextWindow ?? 0;
	if (contextWindow <= 0) return undefined;

	const branchEntries = target.sessionManager.getBranch();
	const latestCompaction = getLatestCompactionEntry(branchEntries);

	if (latestCompaction) {
		const compactionIndex = branchEntries.lastIndexOf(latestCompaction);
		let hasPostCompactionUsage = false;
		for (let i = branchEntries.length - 1; i > compactionIndex; i--) {
			const entry = branchEntries[i];
			if (entry.type === "message" && entry.message.role === "assistant") {
				const assistant = entry.message;
				if (assistant.stopReason !== "aborted" && assistant.stopReason !== "error") {
					const contextTokens = calculateContextTokens(assistant.usage);
					if (contextTokens > 0) {
						hasPostCompactionUsage = true;
					}
					break;
				}
			}
		}

		if (!hasPostCompactionUsage) {
			return { tokens: null, contextWindow, percent: null };
		}
	}

	const estimate = estimateContextTokens(target.messages);
	const percent = (estimate.tokens / contextWindow) * 100;

	return {
		tokens: estimate.tokens,
		contextWindow,
		percent,
	};
}

/**
 * Export the active session branch to an HTML artifact.
 */
export async function exportSessionHtml(target: AgentSessionExportTarget, outputPath?: string): Promise<string> {
	const themeName = target.settingsManager.getTheme();
	const toolRenderer: ToolHtmlRenderer = createToolHtmlRenderer({
		getToolDefinition: (name) => target.getToolDefinition(name),
		theme,
		cwd: target.sessionManager.getCwd(),
	});

	return await exportSessionToHtml(target.sessionManager, target.state, {
		outputPath,
		themeName,
		toolRenderer,
	});
}

/**
 * Export the current session branch as linear JSONL.
 */
export function exportSessionJsonl(target: AgentSessionExportTarget, outputPath?: string): string {
	const filePath = resolve(outputPath ?? `session-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
	const dir = dirname(filePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	const header: SessionHeader = {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id: target.sessionManager.getSessionId(),
		timestamp: new Date().toISOString(),
		cwd: target.sessionManager.getCwd(),
	};

	const branchEntries = target.sessionManager.getBranch();
	const lines = [JSON.stringify(header)];

	let prevId: string | null = null;
	for (const entry of branchEntries) {
		const linear = { ...entry, parentId: prevId };
		lines.push(JSON.stringify(linear));
		prevId = entry.id;
	}

	writeFileSync(filePath, `${lines.join("\n")}\n`);
	return filePath;
}

/**
 * Return text from the last non-empty assistant message.
 */
export function getLastAssistantText(messages: readonly AgentMessage[]): string | undefined {
	const lastAssistant = messages
		.slice()
		.reverse()
		.find((m) => {
			if (m.role !== "assistant") return false;
			const msg = m as AssistantMessage;
			if (msg.stopReason === "aborted" && msg.content.length === 0) return false;
			return true;
		});

	if (!lastAssistant) return undefined;

	let text = "";
	for (const content of (lastAssistant as AssistantMessage).content) {
		if (content.type === "text") {
			text += content.text;
		}
	}

	return text.trim() || undefined;
}
