/**
 * Active tool selection boundary for AgentSession.
 *
 * Tool registry construction is handled by `tool-registry.ts`; this module owns
 * the mutable active-tool state on the Agent and the matching system-prompt
 * rebuild when callers enable a new tool set.
 */

import type { Agent, AgentTool } from "@mariozechner/pi-agent-core";
import type { ToolDefinition, ToolInfo } from "../extensions/index.js";
import type { ToolDefinitionEntry } from "./tool-registry.js";

export interface AgentSessionActiveToolTarget {
	agent: Agent;
	_toolRegistry: Map<string, AgentTool>;
	_toolDefinitions: Map<string, ToolDefinitionEntry>;
	_baseSystemPrompt: string;
	_rebuildSystemPrompt(toolNames: string[]): string;
}

/**
 * Return active tool names in the order currently configured on the Agent.
 */
export function getActiveToolNames(target: AgentSessionActiveToolTarget): string[] {
	return target.agent.state.tools.map((tool) => tool.name);
}

/**
 * Return all registered tool definitions with source metadata for UI display.
 */
export function getAllTools(target: AgentSessionActiveToolTarget): ToolInfo[] {
	return Array.from(target._toolDefinitions.values()).map(({ definition, sourceInfo }) => ({
		name: definition.name,
		description: definition.description,
		parameters: definition.parameters,
		sourceInfo,
	}));
}

/**
 * Resolve a registered tool definition by name.
 */
export function getToolDefinition(target: AgentSessionActiveToolTarget, name: string): ToolDefinition | undefined {
	return target._toolDefinitions.get(name)?.definition;
}

/**
 * Enable only registered tools matching the provided names and rebuild the
 * system prompt to reflect the active set.
 */
export function setActiveToolsByName(target: AgentSessionActiveToolTarget, toolNames: string[]): void {
	const tools: AgentTool[] = [];
	const validToolNames: string[] = [];
	for (const name of toolNames) {
		const tool = target._toolRegistry.get(name);
		if (tool) {
			tools.push(tool);
			validToolNames.push(name);
		}
	}
	target.agent.state.tools = tools;

	target._baseSystemPrompt = target._rebuildSystemPrompt(validToolNames);
	target.agent.state.systemPrompt = target._baseSystemPrompt;
}
