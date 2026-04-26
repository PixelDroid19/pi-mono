/**
 * Prompt text expansion utilities shared by AgentSession prompt intake.
 *
 * Skill commands, prompt templates, and extension input events all transform
 * user text before it becomes an Agent message. These functions keep the text
 * transformation rules independent from queueing and streaming state.
 */

import { readFileSync } from "node:fs";
import { stripFrontmatter } from "../../utils/frontmatter.js";
import type { ExtensionRunner } from "../extensions/index.js";
import { expandPromptTemplate, type PromptTemplate } from "../prompt-templates.js";
import type { ResourceLoader } from "../resource-loader.js";

/**
 * Expand a `/skill:name` command into the markdown block sent to the model.
 *
 * Missing skills and non-skill prompts are returned unchanged so callers can run
 * this in the normal prompt pipeline without pre-validating command names.
 */
export function expandSkillCommand(
	text: string,
	resourceLoader: ResourceLoader,
	extensionRunner?: ExtensionRunner,
): string {
	if (!text.startsWith("/skill:")) return text;

	const spaceIndex = text.indexOf(" ");
	const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
	const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

	const skill = resourceLoader.getSkills().skills.find((s) => s.name === skillName);
	if (!skill) return text;

	try {
		const content = readFileSync(skill.filePath, "utf-8");
		const body = stripFrontmatter(content).trim();
		const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
		return args ? `${skillBlock}\n\n${args}` : skillBlock;
	} catch (err) {
		extensionRunner?.emitError({
			extensionPath: skill.filePath,
			event: "skill_expansion",
			error: err instanceof Error ? err.message : String(err),
		});
		return text;
	}
}

/**
 * Expand prompt templates in text using the loaded templates.
 */
export function expandPromptTemplatesInText(text: string, templates: ReadonlyArray<PromptTemplate>): string {
	return expandPromptTemplate(text, [...templates]);
}

/**
 * Parse a potential extension command from text.
 * Returns command name and args, or undefined if not a command.
 */
export function parseExtensionCommand(text: string): { commandName: string; args: string } | undefined {
	if (!text.startsWith("/")) return undefined;
	const spaceIndex = text.indexOf(" ");
	const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
	const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
	return { commandName, args };
}
