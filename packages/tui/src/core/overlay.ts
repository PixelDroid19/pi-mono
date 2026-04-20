/**
 * Overlay positioning, sizing, and compositing
 */

import { isImageLine } from "../terminal-image.js";
import { extractSegments, sliceByColumn, sliceWithWidth, visibleWidth } from "../utils.js";
import type { Component } from "./types.js";

/**
 * Anchor position for overlays
 */
export type OverlayAnchor =
	| "center"
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right"
	| "top-center"
	| "bottom-center"
	| "left-center"
	| "right-center";

/**
 * Margin configuration for overlays
 */
export interface OverlayMargin {
	top?: number;
	right?: number;
	bottom?: number;
	left?: number;
}

/** Value that can be absolute (number) or percentage (string like "50%") */
export type SizeValue = number | `${number}%`;

/** Parse a SizeValue into absolute value given a reference size */
export function parseSizeValue(value: SizeValue | undefined, referenceSize: number): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number") return value;
	// Parse percentage string like "50%"
	const match = value.match(/^(\d+(?:\.\d+)?)%$/);
	if (match) {
		return Math.floor((referenceSize * parseFloat(match[1])) / 100);
	}
	return undefined;
}

/**
 * Options for overlay positioning and sizing.
 * Values can be absolute numbers or percentage strings (e.g., "50%").
 */
export interface OverlayOptions {
	// === Sizing ===
	/** Width in columns, or percentage of terminal width (e.g., "50%") */
	width?: SizeValue;
	/** Minimum width in columns */
	minWidth?: number;
	/** Maximum height in rows, or percentage of terminal height (e.g., "50%") */
	maxHeight?: SizeValue;

	// === Positioning - anchor-based ===
	/** Anchor point for positioning (default: 'center') */
	anchor?: OverlayAnchor;
	/** Horizontal offset from anchor position (positive = right) */
	offsetX?: number;
	/** Vertical offset from anchor position (positive = down) */
	offsetY?: number;

	// === Positioning - percentage or absolute ===
	/** Row position: absolute number, or percentage (e.g., "25%" = 25% from top) */
	row?: SizeValue;
	/** Column position: absolute number, or percentage (e.g., "50%" = centered horizontally) */
	col?: SizeValue;

	// === Margin from terminal edges ===
	/** Margin from terminal edges. Number applies to all sides. */
	margin?: OverlayMargin | number;

	// === Visibility ===
	/**
	 * Control overlay visibility based on terminal dimensions.
	 * If provided, overlay is only rendered when this returns true.
	 * Called each render cycle with current terminal dimensions.
	 */
	visible?: (termWidth: number, termHeight: number) => boolean;
	/** If true, don't capture keyboard focus when shown */
	nonCapturing?: boolean;
}

/**
 * Handle returned by showOverlay for controlling the overlay
 */
export interface OverlayHandle {
	/** Permanently remove the overlay (cannot be shown again) */
	hide(): void;
	/** Temporarily hide or show the overlay */
	setHidden(hidden: boolean): void;
	/** Check if overlay is temporarily hidden */
	isHidden(): boolean;
	/** Focus this overlay and bring it to the visual front */
	focus(): void;
	/** Release focus to the previous target */
	unfocus(): void;
	/** Check if this overlay currently has focus */
	isFocused(): boolean;
}

/** Internal overlay stack entry */
export interface OverlayEntry {
	component: Component;
	options?: OverlayOptions;
	preFocus: Component | null;
	hidden: boolean;
	focusOrder: number;
}

/** Check if an overlay entry is currently visible */
export function isOverlayVisible(entry: OverlayEntry, termWidth: number, termHeight: number): boolean {
	if (entry.hidden) return false;
	if (entry.options?.visible) {
		return entry.options.visible(termWidth, termHeight);
	}
	return true;
}

/**
 * Resolve overlay layout from options.
 * Returns { width, row, col, maxHeight } for rendering.
 */
export function resolveOverlayLayout(
	options: OverlayOptions | undefined,
	overlayHeight: number,
	termWidth: number,
	termHeight: number,
): { width: number; row: number; col: number; maxHeight: number | undefined } {
	const opt = options ?? {};

	// Parse margin (clamp to non-negative)
	const margin =
		typeof opt.margin === "number"
			? { top: opt.margin, right: opt.margin, bottom: opt.margin, left: opt.margin }
			: (opt.margin ?? {});
	const marginTop = Math.max(0, margin.top ?? 0);
	const marginRight = Math.max(0, margin.right ?? 0);
	const marginBottom = Math.max(0, margin.bottom ?? 0);
	const marginLeft = Math.max(0, margin.left ?? 0);

	// Available space after margins
	const availWidth = Math.max(1, termWidth - marginLeft - marginRight);
	const availHeight = Math.max(1, termHeight - marginTop - marginBottom);

	// === Resolve width ===
	let width = parseSizeValue(opt.width, termWidth) ?? Math.min(80, availWidth);
	// Apply minWidth
	if (opt.minWidth !== undefined) {
		width = Math.max(width, opt.minWidth);
	}
	// Clamp to available space
	width = Math.max(1, Math.min(width, availWidth));

	// === Resolve maxHeight ===
	let maxHeight = parseSizeValue(opt.maxHeight, termHeight);
	// Clamp to available space
	if (maxHeight !== undefined) {
		maxHeight = Math.max(1, Math.min(maxHeight, availHeight));
	}

	// Effective overlay height (may be clamped by maxHeight)
	const effectiveHeight = maxHeight !== undefined ? Math.min(overlayHeight, maxHeight) : overlayHeight;

	// === Resolve position ===
	let row: number;
	let col: number;

	if (opt.row !== undefined) {
		if (typeof opt.row === "string") {
			// Percentage: 0% = top, 100% = bottom (overlay stays within bounds)
			const match = opt.row.match(/^(\d+(?:\.\d+)?)%$/);
			if (match) {
				const maxRow = Math.max(0, availHeight - effectiveHeight);
				const percent = parseFloat(match[1]) / 100;
				row = marginTop + Math.floor(maxRow * percent);
			} else {
				// Invalid format, fall back to center
				row = resolveAnchorRow("center", effectiveHeight, availHeight, marginTop);
			}
		} else {
			// Absolute row position
			row = opt.row;
		}
	} else {
		// Anchor-based (default: center)
		const anchor = opt.anchor ?? "center";
		row = resolveAnchorRow(anchor, effectiveHeight, availHeight, marginTop);
	}

	if (opt.col !== undefined) {
		if (typeof opt.col === "string") {
			// Percentage: 0% = left, 100% = right (overlay stays within bounds)
			const match = opt.col.match(/^(\d+(?:\.\d+)?)%$/);
			if (match) {
				const maxCol = Math.max(0, availWidth - width);
				const percent = parseFloat(match[1]) / 100;
				col = marginLeft + Math.floor(maxCol * percent);
			} else {
				// Invalid format, fall back to center
				col = resolveAnchorCol("center", width, availWidth, marginLeft);
			}
		} else {
			// Absolute column position
			col = opt.col;
		}
	} else {
		// Anchor-based (default: center)
		const anchor = opt.anchor ?? "center";
		col = resolveAnchorCol(anchor, width, availWidth, marginLeft);
	}

	// Apply offsets
	if (opt.offsetY !== undefined) row += opt.offsetY;
	if (opt.offsetX !== undefined) col += opt.offsetX;

	// Clamp to terminal bounds (respecting margins)
	row = Math.max(marginTop, Math.min(row, termHeight - marginBottom - effectiveHeight));
	col = Math.max(marginLeft, Math.min(col, termWidth - marginRight - width));

	return { width, row, col, maxHeight };
}

export function resolveAnchorRow(
	anchor: OverlayAnchor,
	height: number,
	availHeight: number,
	marginTop: number,
): number {
	switch (anchor) {
		case "top-left":
		case "top-center":
		case "top-right":
			return marginTop;
		case "bottom-left":
		case "bottom-center":
		case "bottom-right":
			return marginTop + availHeight - height;
		case "left-center":
		case "center":
		case "right-center":
			return marginTop + Math.floor((availHeight - height) / 2);
	}
}

export function resolveAnchorCol(anchor: OverlayAnchor, width: number, availWidth: number, marginLeft: number): number {
	switch (anchor) {
		case "top-left":
		case "left-center":
		case "bottom-left":
			return marginLeft;
		case "top-right":
		case "right-center":
		case "bottom-right":
			return marginLeft + availWidth - width;
		case "top-center":
		case "center":
		case "bottom-center":
			return marginLeft + Math.floor((availWidth - width) / 2);
	}
}

const SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

export function applyLineResets(lines: string[]): string[] {
	const reset = SEGMENT_RESET;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!isImageLine(line)) {
			lines[i] = line + reset;
		}
	}
	return lines;
}

/** Composite all overlays into content lines (sorted by focusOrder, higher = on top). */
export function compositeOverlays(
	lines: string[],
	overlayStack: OverlayEntry[],
	termWidth: number,
	termHeight: number,
): string[] {
	if (overlayStack.length === 0) return lines;
	const result = [...lines];

	// Pre-render all visible overlays and calculate positions
	const rendered: { overlayLines: string[]; row: number; col: number; w: number }[] = [];
	let minLinesNeeded = result.length;

	const visibleEntries = overlayStack.filter((e) => isOverlayVisible(e, termWidth, termHeight));
	visibleEntries.sort((a, b) => a.focusOrder - b.focusOrder);
	for (const entry of visibleEntries) {
		const { component, options } = entry;

		// Get layout with height=0 first to determine width and maxHeight
		// (width and maxHeight don't depend on overlay height)
		const { width, maxHeight } = resolveOverlayLayout(options, 0, termWidth, termHeight);

		// Render component at calculated width
		let overlayLines = component.render(width);

		// Apply maxHeight if specified
		if (maxHeight !== undefined && overlayLines.length > maxHeight) {
			overlayLines = overlayLines.slice(0, maxHeight);
		}

		// Get final row/col with actual overlay height
		const { row, col } = resolveOverlayLayout(options, overlayLines.length, termWidth, termHeight);

		rendered.push({ overlayLines, row, col, w: width });
		minLinesNeeded = Math.max(minLinesNeeded, row + overlayLines.length);
	}

	// Pad to at least terminal height so overlays have screen-relative positions.
	// Excludes maxLinesRendered: the historical high-water mark caused self-reinforcing
	// inflation that pushed content into scrollback on terminal widen.
	const workingHeight = Math.max(result.length, termHeight, minLinesNeeded);

	// Extend result with empty lines if content is too short for overlay placement or working area
	while (result.length < workingHeight) {
		result.push("");
	}

	const viewportStart = Math.max(0, workingHeight - termHeight);

	// Composite each overlay
	for (const { overlayLines, row, col, w } of rendered) {
		for (let i = 0; i < overlayLines.length; i++) {
			const idx = viewportStart + row + i;
			if (idx >= 0 && idx < result.length) {
				// Defensive: truncate overlay line to declared width before compositing
				// (components should already respect width, but this ensures it)
				const truncatedOverlayLine =
					visibleWidth(overlayLines[i]) > w ? sliceByColumn(overlayLines[i], 0, w, true) : overlayLines[i];
				result[idx] = compositeLineAt(result[idx], truncatedOverlayLine, col, w, termWidth);
			}
		}
	}

	return result;
}

/** Splice overlay content into a base line at a specific column. Single-pass optimized. */
function compositeLineAt(
	baseLine: string,
	overlayLine: string,
	startCol: number,
	overlayWidth: number,
	totalWidth: number,
): string {
	if (isImageLine(baseLine)) return baseLine;

	// Single pass through baseLine extracts both before and after segments
	const afterStart = startCol + overlayWidth;
	const base = extractSegments(baseLine, startCol, afterStart, totalWidth - afterStart, true);

	// Extract overlay with width tracking (strict=true to exclude wide chars at boundary)
	const overlay = sliceWithWidth(overlayLine, 0, overlayWidth, true);

	// Pad segments to target widths
	const beforePad = Math.max(0, startCol - base.beforeWidth);
	const overlayPad = Math.max(0, overlayWidth - overlay.width);
	const actualBeforeWidth = Math.max(startCol, base.beforeWidth);
	const actualOverlayWidth = Math.max(overlayWidth, overlay.width);
	const afterTarget = Math.max(0, totalWidth - actualBeforeWidth - actualOverlayWidth);
	const afterPad = Math.max(0, afterTarget - base.afterWidth);

	// Compose result
	const r = SEGMENT_RESET;
	const result =
		base.before +
		" ".repeat(beforePad) +
		r +
		overlay.text +
		" ".repeat(overlayPad) +
		r +
		base.after +
		" ".repeat(afterPad);

	// CRITICAL: Always verify and truncate to terminal width.
	const resultWidth = visibleWidth(result);
	if (resultWidth <= totalWidth) {
		return result;
	}
	// Truncate with strict=true to ensure we don't exceed totalWidth
	return sliceByColumn(result, 0, totalWidth, true);
}
