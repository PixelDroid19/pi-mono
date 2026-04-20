import { Container, type Focusable, fuzzyFilter, getKeybindings, Input, Spacer, Text } from "@mariozechner/pi-tui";
import type { Skill } from "../../../core/skills.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

const MAX_VISIBLE_SKILLS = 10;
const MAX_NAME_LENGTH = 40;
const MAX_DESCRIPTION_LENGTH = 120;

interface SkillItem {
	name: string;
	description: string;
}

function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}

	return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

export class SkillSelectorComponent extends Container implements Focusable {
	private searchInput: Input;
	private listContainer: Container;
	private allSkills: SkillItem[];
	private filteredSkills: SkillItem[];
	private selectedIndex: number = 0;
	private onSelectCallback: (skillName: string) => void;
	private onCancelCallback: () => void;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	constructor(
		skills: Skill[],
		onSelect: (skillName: string) => void,
		onCancel: () => void,
		initialSearchInput?: string,
	) {
		super();

		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;
		this.allSkills = [...skills]
			.map((skill) => ({
				name: skill.name,
				description: skill.description,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
		this.filteredSkills = this.allSkills;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("muted", "Type to filter skills. Enter selects. Esc cancels."), 0, 0));
		this.addChild(new Spacer(1));

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

		this.listContainer = new Container();
		this.addChild(this.listContainer);

		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

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

		if (this.filteredSkills.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "  No matching skills"), 0, 0));
			return;
		}

		const startIndex = Math.max(
			0,
			Math.min(
				this.selectedIndex - Math.floor(MAX_VISIBLE_SKILLS / 2),
				this.filteredSkills.length - MAX_VISIBLE_SKILLS,
			),
		);
		const endIndex = Math.min(startIndex + MAX_VISIBLE_SKILLS, this.filteredSkills.length);

		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredSkills[i];
			if (!item) continue;

			const isSelected = i === this.selectedIndex;
			const displayName = truncateText(item.name, MAX_NAME_LENGTH);
			const line = isSelected ? `${theme.fg("accent", "> ")}${theme.fg("accent", displayName)}` : `  ${displayName}`;
			this.listContainer.addChild(new Text(line, 0, 0));
		}

		if (startIndex > 0 || endIndex < this.filteredSkills.length) {
			const scrollInfo = theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredSkills.length})`);
			this.listContainer.addChild(new Text(scrollInfo, 0, 0));
		}

		const selected = this.filteredSkills[this.selectedIndex];
		if (selected) {
			this.listContainer.addChild(new Spacer(1));
			this.listContainer.addChild(
				new Text(theme.fg("muted", `  ${truncateText(selected.description, MAX_DESCRIPTION_LENGTH)}`), 0, 0),
			);
		}
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up")) {
			if (this.filteredSkills.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredSkills.length - 1 : this.selectedIndex - 1;
			this.updateList();
			return;
		}

		if (kb.matches(keyData, "tui.select.down")) {
			if (this.filteredSkills.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredSkills.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
			return;
		}

		if (kb.matches(keyData, "tui.select.confirm")) {
			const selected = this.filteredSkills[this.selectedIndex];
			if (selected) {
				this.onSelectCallback(selected.name);
			}
			return;
		}

		if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancelCallback();
			return;
		}

		this.searchInput.handleInput(keyData);
		this.filterSkills(this.searchInput.getValue());
	}
}
