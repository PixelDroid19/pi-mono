/**
 * Text component whose content switches between compact and expanded variants.
 *
 * Interactive screens use this for startup/resource sections that must preserve
 * the same component identity while the global tool-output expansion setting is
 * toggled.
 */

import { Text } from "@mariozechner/pi-tui";

/** Component contract for sections that can follow global expansion state. */
export interface Expandable {
	setExpanded(expanded: boolean): void;
}

/** Return true when a component supports the expansion contract. */
export function isExpandable(obj: unknown): obj is Expandable {
	return typeof obj === "object" && obj !== null && "setExpanded" in obj && typeof obj.setExpanded === "function";
}

/** Text component backed by lazy collapsed and expanded labels. */
export class ExpandableText extends Text implements Expandable {
	constructor(
		private readonly getCollapsedText: () => string,
		private readonly getExpandedText: () => string,
		expanded = false,
		paddingX = 0,
		paddingY = 0,
	) {
		super(expanded ? getExpandedText() : getCollapsedText(), paddingX, paddingY);
	}

	setExpanded(expanded: boolean): void {
		this.setText(expanded ? this.getExpandedText() : this.getCollapsedText());
	}
}
