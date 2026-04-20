/**
 * Visual line navigation helpers for the editor.
 *
 * Provides pure functions for mapping between logical text lines and
 * visual (wrapped) lines, finding cursor positions within visual lines,
 * and computing the target column for vertical cursor movement (sticky
 * column logic).
 */

import { visibleWidth } from "../utils.js";
import { type TextChunk, wordWrapLine } from "./editor-word-wrap.js";

/** A visual line segment mapping back to a range within a logical line. */
export interface VisualLine {
	logicalLine: number;
	startCol: number;
	length: number;
}

/**
 * Build a mapping from visual lines to logical positions.
 *
 * @param lines - The logical lines of text
 * @param width - The wrap width (visible columns)
 * @param segmentFn - Function to segment a line with paste-marker awareness
 * @returns Array of visual line descriptors
 */
export function buildVisualLineMap(
	lines: string[],
	width: number,
	segmentFn: (text: string) => Iterable<Intl.SegmentData>,
): VisualLine[] {
	const visualLines: VisualLine[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] || "";
		const lineVisWidth = visibleWidth(line);
		if (line.length === 0) {
			// Empty line still takes one visual line
			visualLines.push({ logicalLine: i, startCol: 0, length: 0 });
		} else if (lineVisWidth <= width) {
			visualLines.push({ logicalLine: i, startCol: 0, length: line.length });
		} else {
			// Line needs wrapping - use word-aware wrapping
			const chunks: TextChunk[] = wordWrapLine(line, width, [...segmentFn(line)]);
			for (const chunk of chunks) {
				visualLines.push({
					logicalLine: i,
					startCol: chunk.startIndex,
					length: chunk.endIndex - chunk.startIndex,
				});
			}
		}
	}

	return visualLines;
}

/**
 * Find the visual line index that contains the given logical position.
 */
export function findVisualLineAt(visualLines: VisualLine[], line: number, col: number): number {
	for (let i = 0; i < visualLines.length; i++) {
		const vl = visualLines[i];
		if (!vl || vl.logicalLine !== line) continue;
		const offset = col - vl.startCol;
		// Cursor is in this segment if it's within range. For the last
		// segment of a logical line, cursor can be at length (end position)
		const isLastSegmentOfLine = i === visualLines.length - 1 || visualLines[i + 1]?.logicalLine !== vl.logicalLine;
		if (offset >= 0 && (offset < vl.length || (isLastSegmentOfLine && offset === vl.length))) {
			return i;
		}
	}
	return visualLines.length - 1;
}

/**
 * Compute the target visual column for vertical cursor movement.
 * Implements the sticky column decision table:
 *
 * | P | S | T | U | Scenario                                             | Set Preferred | Move To     |
 * |---|---|---|---| ---------------------------------------------------- |---------------|-------------|
 * | 0 | * | 0 | - | Start nav, target fits                               | null          | current     |
 * | 0 | * | 1 | - | Start nav, target shorter                            | current       | target end  |
 * | 1 | 0 | 0 | 0 | Clamped, target fits preferred                       | null          | preferred   |
 * | 1 | 0 | 0 | 1 | Clamped, target longer but still can't fit preferred | keep          | target end  |
 * | 1 | 0 | 1 | - | Clamped, target even shorter                         | keep          | target end  |
 * | 1 | 1 | 0 | - | Rewrapped, target fits current                       | null          | current     |
 * | 1 | 1 | 1 | - | Rewrapped, target shorter than current               | current       | target end  |
 *
 * Where:
 * - P = preferred col is set
 * - S = cursor in middle of source line (not clamped to end)
 * - T = target line shorter than current visual col
 * - U = target line shorter than preferred col
 *
 * @returns The column to move to and the updated preferredVisualCol
 */
export function computeVerticalMoveColumn(
	currentVisualCol: number,
	sourceMaxVisualCol: number,
	targetMaxVisualCol: number,
	preferredVisualCol: number | null,
): { col: number; preferredVisualCol: number | null } {
	const hasPreferred = preferredVisualCol !== null; // P
	const cursorInMiddle = currentVisualCol < sourceMaxVisualCol; // S
	const targetTooShort = targetMaxVisualCol < currentVisualCol; // T

	if (!hasPreferred || cursorInMiddle) {
		if (targetTooShort) {
			// Cases 2 and 7
			return { col: targetMaxVisualCol, preferredVisualCol: currentVisualCol };
		}

		// Cases 1 and 6
		return { col: currentVisualCol, preferredVisualCol: null };
	}

	const targetCantFitPreferred = targetMaxVisualCol < preferredVisualCol!; // U
	if (targetTooShort || targetCantFitPreferred) {
		// Cases 4 and 5
		return { col: targetMaxVisualCol, preferredVisualCol };
	}

	// Case 3
	return { col: preferredVisualCol!, preferredVisualCol: null };
}
