/**
 * Pure layout computation for the editor.
 *
 * Converts logical text lines and a cursor position into an array of
 * visual LayoutLine descriptors suitable for rendering. Handles
 * word-wrapping via {@link wordWrapLine} and assigns cursor positions
 * to the correct visual chunk.
 */

import { visibleWidth } from "../utils.js";
import { wordWrapLine } from "./editor-word-wrap.js";

/**
 * A single visual line produced by layoutText, mapping a segment of the
 * rendered output back to the cursor position in the logical text.
 */
export interface LayoutLine {
	text: string;
	hasCursor: boolean;
	cursorPos?: number;
}

/**
 * Convert logical editor lines into visual layout lines.
 *
 * Each logical line that exceeds `contentWidth` is word-wrapped into
 * multiple visual lines via {@link wordWrapLine}. The cursor position
 * is projected onto the correct visual chunk so the renderer can
 * highlight it.
 *
 * @param lines       - Logical lines of text (one per `\n` boundary).
 * @param cursorLine  - Zero-based index of the logical line containing the cursor.
 * @param cursorCol   - Zero-based column offset of the cursor within `cursorLine`.
 * @param contentWidth - Maximum visible width (columns) before wrapping.
 * @param segmentFn   - Grapheme segmenter aware of paste markers, used by wordWrapLine.
 * @returns Flat array of visual lines with cursor metadata.
 */
export function layoutText(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
	contentWidth: number,
	segmentFn: (text: string) => Iterable<Intl.SegmentData>,
): LayoutLine[] {
	const layoutLines: LayoutLine[] = [];

	if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
		// Empty editor
		layoutLines.push({
			text: "",
			hasCursor: true,
			cursorPos: 0,
		});
		return layoutLines;
	}

	// Process each logical line
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] || "";
		const isCurrentLine = i === cursorLine;
		const lineVisibleWidth = visibleWidth(line);

		if (lineVisibleWidth <= contentWidth) {
			// Line fits in one layout line
			if (isCurrentLine) {
				layoutLines.push({
					text: line,
					hasCursor: true,
					cursorPos: cursorCol,
				});
			} else {
				layoutLines.push({
					text: line,
					hasCursor: false,
				});
			}
		} else {
			// Line needs wrapping - use word-aware wrapping
			const chunks = wordWrapLine(line, contentWidth, [...segmentFn(line)]);

			for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
				const chunk = chunks[chunkIndex];
				if (!chunk) continue;

				const isLastChunk = chunkIndex === chunks.length - 1;

				// Determine if cursor is in this chunk
				let hasCursorInChunk = false;
				let adjustedCursorPos = 0;

				if (isCurrentLine) {
					if (isLastChunk) {
						// Last chunk: cursor belongs here if >= startIndex
						hasCursorInChunk = cursorCol >= chunk.startIndex;
						adjustedCursorPos = cursorCol - chunk.startIndex;
					} else {
						// Non-last chunk: cursor belongs here if in range [startIndex, endIndex)
						hasCursorInChunk = cursorCol >= chunk.startIndex && cursorCol < chunk.endIndex;
						if (hasCursorInChunk) {
							adjustedCursorPos = cursorCol - chunk.startIndex;
							// Clamp to text length (in case cursor was in trimmed whitespace)
							if (adjustedCursorPos > chunk.text.length) {
								adjustedCursorPos = chunk.text.length;
							}
						}
					}
				}

				if (hasCursorInChunk) {
					layoutLines.push({
						text: chunk.text,
						hasCursor: true,
						cursorPos: adjustedCursorPos,
					});
				} else {
					layoutLines.push({
						text: chunk.text,
						hasCursor: false,
					});
				}
			}
		}
	}

	return layoutLines;
}
