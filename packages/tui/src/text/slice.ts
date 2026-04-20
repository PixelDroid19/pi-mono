/**
 * Column-based text slicing with ANSI code awareness.
 *
 * Extracts visible column ranges from ANSI-styled text for overlay
 * compositing and other operations that need sub-line extraction.
 */

import { AnsiCodeTracker, extractAnsiCode } from "./ansi.js";
import { getSegmenter, graphemeWidth } from "./width.js";

/**
 * Extract a range of visible columns from a line. Handles ANSI codes and wide chars.
 * @param strict - If true, exclude wide chars at boundary that would extend past the range
 */
export function sliceByColumn(line: string, startCol: number, length: number, strict = false): string {
	return sliceWithWidth(line, startCol, length, strict).text;
}

/** Like sliceByColumn but also returns the actual visible width of the result. */
export function sliceWithWidth(
	line: string,
	startCol: number,
	length: number,
	strict = false,
): { text: string; width: number } {
	if (length <= 0) return { text: "", width: 0 };
	const segmenter = getSegmenter();
	const endCol = startCol + length;
	let result = "",
		resultWidth = 0,
		currentCol = 0,
		i = 0,
		pendingAnsi = "";

	while (i < line.length) {
		const ansi = extractAnsiCode(line, i);
		if (ansi) {
			if (currentCol >= startCol && currentCol < endCol) result += ansi.code;
			else if (currentCol < startCol) pendingAnsi += ansi.code;
			i += ansi.length;
			continue;
		}

		let textEnd = i;
		while (textEnd < line.length && !extractAnsiCode(line, textEnd)) textEnd++;

		for (const { segment } of segmenter.segment(line.slice(i, textEnd))) {
			const w = graphemeWidth(segment);
			const inRange = currentCol >= startCol && currentCol < endCol;
			const fits = !strict || currentCol + w <= endCol;
			if (inRange && fits) {
				if (pendingAnsi) {
					result += pendingAnsi;
					pendingAnsi = "";
				}
				result += segment;
				resultWidth += w;
			}
			currentCol += w;
			if (currentCol >= endCol) break;
		}
		i = textEnd;
		if (currentCol >= endCol) break;
	}
	return { text: result, width: resultWidth };
}

// Pooled tracker instance for extractSegments (avoids allocation per call)
const pooledStyleTracker = new AnsiCodeTracker();

/**
 * Extract "before" and "after" segments from a line in a single pass.
 * Used for overlay compositing where we need content before and after the overlay region.
 * Preserves styling from before the overlay that should affect content after it.
 */
export function extractSegments(
	line: string,
	beforeEnd: number,
	afterStart: number,
	afterLen: number,
	strictAfter = false,
): { before: string; beforeWidth: number; after: string; afterWidth: number } {
	const segmenter = getSegmenter();
	let before = "",
		beforeWidth = 0,
		after = "",
		afterWidth = 0;
	let currentCol = 0,
		i = 0;
	let pendingAnsiBefore = "";
	let afterStarted = false;
	const afterEnd = afterStart + afterLen;

	// Track styling state so "after" inherits styling from before the overlay
	pooledStyleTracker.clear();

	while (i < line.length) {
		const ansi = extractAnsiCode(line, i);
		if (ansi) {
			// Track all SGR codes to know styling state at afterStart
			pooledStyleTracker.process(ansi.code);
			// Include ANSI codes in their respective segments
			if (currentCol < beforeEnd) {
				pendingAnsiBefore += ansi.code;
			} else if (currentCol >= afterStart && currentCol < afterEnd && afterStarted) {
				// Only include after we've started "after" (styling already prepended)
				after += ansi.code;
			}
			i += ansi.length;
			continue;
		}

		let textEnd = i;
		while (textEnd < line.length && !extractAnsiCode(line, textEnd)) textEnd++;

		for (const { segment } of segmenter.segment(line.slice(i, textEnd))) {
			const w = graphemeWidth(segment);

			if (currentCol < beforeEnd) {
				if (pendingAnsiBefore) {
					before += pendingAnsiBefore;
					pendingAnsiBefore = "";
				}
				before += segment;
				beforeWidth += w;
			} else if (currentCol >= afterStart && currentCol < afterEnd) {
				const fits = !strictAfter || currentCol + w <= afterEnd;
				if (fits) {
					// On first "after" grapheme, prepend inherited styling from before overlay
					if (!afterStarted) {
						after += pooledStyleTracker.getActiveCodes();
						afterStarted = true;
					}
					after += segment;
					afterWidth += w;
				}
			}

			currentCol += w;
			// Early exit: done with "before" only, or done with both segments
			if (afterLen <= 0 ? currentCol >= beforeEnd : currentCol >= afterEnd) break;
		}
		i = textEnd;
		if (afterLen <= 0 ? currentCol >= beforeEnd : currentCol >= afterEnd) break;
	}

	return { before, beforeWidth, after, afterWidth };
}
