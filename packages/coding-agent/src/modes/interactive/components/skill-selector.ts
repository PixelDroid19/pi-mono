import { Container, type Focusable, fuzzyFilter, getKeybindings, Input, Spacer, Text } from "@mariozechner/pi-tui";
import type { Skill } from "../../../core/skills.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

interface SkillItem {
	name: string;
	description: string;
}

/**
 * Component that renders a skill selector with search
 */
export class SkillSelectorComponent extends Container implements Focusable {
	private searchInput: Input;

	// Focusable implementation - propagate to searchInput for IME cursor positioning
	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	private listContainer: Container;
	private allSkills: SkillItem[] = [];
	private filteredSkills: SkillItem[] = [];
	private selectedIndex: number = 0;
	private onSelectCallback: (skillName: string) => void;
	private onCancelCallback: () => void;

	constructor(
		skills: Skill[],
		onSelect: (skillName: string) => void,
		onCancel: () => void,
		initialSearchInput?: string,
	) {
		super();

		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;

		this.allSkills = skills.map((skill) => ({
			name: skill.name,
			description: skill.description,
		}));
		this.filteredSkills = this.allSkills;

		// Add top border
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Hint text
		this.addChild(
			new Text(theme.fg("muted", "Select a skill (type to filter, Enter to select, Esc to cancel)"), 0, 0),
		);
		this.addChild(new Spacer(1));

		// Create search input
		this.searchInput = new Input();
		if (initialSearchInput) {
			this.searchInput.setValue(initialSearchInput);
		}
		this.searchInput.onSubmit = () => {
			const selected = this.filteredSkills[this.selectedIndex];
			if (selected) {
				this.onSelectCallback(selected.name);
			}
		};
		this.addChild(this.searchInput);

		this.addChild(new Spacer(1));

		// Create list container
		this.listContainer = new Container();
		this.addChild(this.listContainer);

		this.addChild(new Spacer(1));

		// Add bottom border
		this.addChild(new DynamicBorder());

		// Initial render
		if (initialSearchInput) {
			this.filterSkills(initialSearchInput);
		} else {
			this.updateList();
		}
	}

	private filterSkills(query: string): void {
		this.filteredSkills = query
			? fuzzyFilter(this.allSkills, query, (item) => `${item.name} ${item.description}`)
			: this.allSkills;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredSkills.length - 1));
		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();

		const maxVisible = 10;
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filteredSkills.length - maxVisible),
		);
		const endIndex = Math.min(startIndex + maxVisible, this.filteredSkills.length);

		// Calculate max name width for alignment
		const visibleItems = this.filteredSkills.slice(startIndex, endIndex);
		const maxNameWidth = Math.min(40, Math.max(12, ...visibleItems.map((item) => item.name.length)));

		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredSkills[i];
			if (!item) continue;

			const isSelected = i === this.selectedIndex;
			const paddedName = item.name.padEnd(maxNameWidth);
			const desc = item.description ? `  ${item.description}` : "";

			let line: string;
			if (isSelected) {
				const prefix = theme.fg("accent", "\u2192 ");
				line = `${prefix}${theme.fg("accent", paddedName)}${theme.fg("muted", desc)}`;
			} else {
				line = `  ${paddedName}${theme.fg("muted", desc)}`;
			}

			this.listContainer.addChild(new Text(line, 0, 0));
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < this.filteredSkills.length) {
			const scrollInfo = theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredSkills.length})`);
			this.listContainer.addChild(new Text(scrollInfo, 0, 0));
		}

		// Show "no results" if empty
		if (this.filteredSkills.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "  No matching skills"), 0, 0));
		}
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		// Up arrow - wrap to bottom when at top
		if (kb.matches(keyData, "tui.select.up")) {
			if (this.filteredSkills.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredSkills.length - 1 : this.selectedIndex - 1;
			this.updateList();
		}
		// Down arrow - wrap to top when at bottom
		else if (kb.matches(keyData, "tui.select.down")) {
			if (this.filteredSkills.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredSkills.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
		}
		// Enter
		else if (kb.matches(keyData, "tui.select.confirm")) {
			const selected = this.filteredSkills[this.selectedIndex];
			if (selected) {
				this.onSelectCallback(selected.name);
			}
		}
		// Escape or Ctrl+C
		else if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancelCallback();
		}
		// Pass everything else to search input
		else {
			this.searchInput.handleInput(keyData);
			this.filterSkills(this.searchInput.getValue());
		}
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
