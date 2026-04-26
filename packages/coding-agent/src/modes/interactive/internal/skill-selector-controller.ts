/**
 * Skill command selector controller for InteractiveMode.
 *
 * This module owns the behavior behind `/skills`: empty-state handling, exact
 * skill-name execution, and selector rendering for fuzzy selection. The exact
 * match path intentionally submits `/skill:<name>` immediately when the editor
 * submit callback is available.
 */

import type { Component, EditorComponent, TUI } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { CustomEditor } from "../components/custom-editor.js";
import { SkillSelectorComponent } from "../components/skill-selector.js";

export interface SkillSelectorTarget {
	defaultEditor: CustomEditor;
	editor: EditorComponent;
	session: AgentSession;
	ui: TUI;
	showSelector(create: (done: () => void) => { component: Component; focus: Component }): void;
	showStatus(message: string): void;
}

/** Execute `/skills` or open the selector for filtered skill selection. */
export async function handleSkillsCommand(target: SkillSelectorTarget, searchTerm?: string): Promise<void> {
	const skills = target.session.resourceLoader.getSkills().skills;
	if (skills.length === 0) {
		target.showStatus("No skills available");
		return;
	}

	if (searchTerm) {
		const exactMatch = skills.find((skill) => skill.name === searchTerm);
		if (exactMatch) {
			const submit = target.defaultEditor.onSubmit;
			if (submit) {
				await submit(`/skill:${exactMatch.name}`);
				return;
			}

			target.editor.setText(`/skill:${exactMatch.name} `);
			return;
		}
	}

	showSkillSelector(target, searchTerm);
}

/** Show the interactive selector for inserting a skill command into the editor. */
export function showSkillSelector(target: SkillSelectorTarget, initialFilter?: string): void {
	const skills = target.session.resourceLoader.getSkills().skills;
	if (skills.length === 0) {
		target.showStatus("No skills available");
		return;
	}

	target.showSelector((done) => {
		const selector = new SkillSelectorComponent(
			skills,
			(skillName) => {
				done();
				target.editor.setText(`/skill:${skillName} `);
				target.ui.requestRender();
			},
			() => {
				done();
				target.ui.requestRender();
			},
			initialFilter,
		);

		return { component: selector, focus: selector };
	});
}
