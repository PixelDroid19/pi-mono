/**
 * Tool registry and system-prompt tool definition boundary.
 *
 * AgentSession combines built-in tools, extension tools, and CLI tool filters
 * into the active Agent tool list. This module owns that registry shape and the
 * prompt snippets derived from it so model/tool changes can rebuild the system
 * prompt without duplicating tool assembly logic.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ToolDefinition } from "../extensions/index.js";
import type { ResourceLoader } from "../resource-loader.js";
import type { SourceInfo } from "../source-info.js";
import { type BuildSystemPromptOptions, buildSystemPrompt } from "../system-prompt.js";

export interface ToolDefinitionEntry {
	definition: ToolDefinition;
	sourceInfo: SourceInfo;
}

/**
 * Filter active tools from a registry by name.
 * Returns only tools whose names are in the provided list.
 */
export function filterActiveTools(toolRegistry: Map<string, AgentTool>, toolNames: string[]): AgentTool[] {
	const tools: AgentTool[] = [];
	for (const name of toolNames) {
		const tool = toolRegistry.get(name);
		if (tool) {
			tools.push(tool);
		}
	}
	return tools;
}

/**
 * Normalize a prompt snippet (collapse whitespace, trim).
 */
export function normalizePromptSnippet(text: string | undefined): string | undefined {
	if (!text) return undefined;
	const oneLine = text
		.replace(/[\r\n]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return oneLine.length > 0 ? oneLine : undefined;
}

/**
 * Normalize and deduplicate prompt guidelines.
 */
export function normalizePromptGuidelines(guidelines: string[] | undefined): string[] {
	if (!guidelines || guidelines.length === 0) {
		return [];
	}

	const unique = new Set<string>();
	for (const guideline of guidelines) {
		const normalized = guideline.trim();
		if (normalized.length > 0) {
			unique.add(normalized);
		}
	}
	return Array.from(unique);
}

/**
 * Build the system prompt from active tools and resource loader state.
 */
export function buildSystemPromptFromTools(
	cwd: string,
	toolNames: string[],
	toolRegistry: Map<string, AgentTool>,
	toolPromptSnippets: Map<string, string>,
	toolPromptGuidelines: Map<string, string[]>,
	resourceLoader: ResourceLoader,
): { options: BuildSystemPromptOptions; prompt: string } {
	const validToolNames = toolNames.filter((name) => toolRegistry.has(name));
	const toolSnippets: Record<string, string> = {};
	const promptGuidelines: string[] = [];

	for (const name of validToolNames) {
		const snippet = toolPromptSnippets.get(name);
		if (snippet) {
			toolSnippets[name] = snippet;
		}

		const guidelines = toolPromptGuidelines.get(name);
		if (guidelines) {
			promptGuidelines.push(...guidelines);
		}
	}

	const loaderSystemPrompt = resourceLoader.getSystemPrompt();
	const loaderAppendSystemPrompt = resourceLoader.getAppendSystemPrompt();
	const appendSystemPrompt = loaderAppendSystemPrompt.length > 0 ? loaderAppendSystemPrompt.join("\n\n") : undefined;
	const loadedSkills = resourceLoader.getSkills().skills;
	const loadedContextFiles = resourceLoader.getAgentsFiles().agentsFiles;

	const options: BuildSystemPromptOptions = {
		cwd,
		skills: loadedSkills,
		contextFiles: loadedContextFiles,
		customPrompt: loaderSystemPrompt,
		appendSystemPrompt,
		selectedTools: validToolNames,
		toolSnippets,
		promptGuidelines,
	};

	return { options, prompt: buildSystemPrompt(options) };
}
