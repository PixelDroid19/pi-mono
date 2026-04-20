/**
 * Text truncation with ANSI code awareness.
 *
 * Truncates text to fit within a maximum visible terminal width,
 * adding ellipsis if needed and optionally padding to exact width.
 */

import { extractAnsiCode } from "./ansi.js";
import { getSegmenter, graphemeWidth, isPrintableAscii, visibleWidth } from "./width.js";

function truncateFragmentToWidth(text: string, maxWidth: number): { text: string; width: number } {
	if (maxWidth <= 0 || text.length === 0) {
		return { text: "", width: 0 };
	}

	const segmenter = getSegmenter();

	if (isPrintableAscii(text)) {
		const clipped = text.slice(0, maxWidth);
		return { text: clipped, width: clipped.length };
	}

	const hasAnsi = text.includes("\x1b");
	const hasTabs = text.includes("\t");
	if (!hasAnsi && !hasTabs) {
		let result = "";
		let width = 0;
		for (const { segment } of segmenter.segment(text)) {
			const w = graphemeWidth(segment);
			if (width + w > maxWidth) {
				break;
			}
			result += segment;
			width += w;
		}
		return { text: result, width };
	}

	let result = "";
	let width = 0;
	let i = 0;
	let pendingAnsi = "";

	while (i < text.length) {
		const ansi = extractAnsiCode(text, i);
		if (ansi) {
			pendingAnsi += ansi.code;
			i += ansi.length;
			continue;
		}

		if (text[i] === "\t") {
			if (width + 3 > maxWidth) {
				break;
			}
			if (pendingAnsi) {
				result += pendingAnsi;
				pendingAnsi = "";
			}
			result += "\t";
			width += 3;
			i++;
			continue;
		}

		let end = i;
		while (end < text.length && text[end] !== "\t") {
			const nextAnsi = extractAnsiCode(text, end);
			if (nextAnsi) {
				break;
			}
			end++;
		}

		for (const { segment } of segmenter.segment(text.slice(i, end))) {
			const w = graphemeWidth(segment);
			if (width + w > maxWidth) {
				return { text: result, width };
			}
			if (pendingAnsi) {
				result += pendingAnsi;
				pendingAnsi = "";
			}
			result += segment;
			width += w;
		}
		i = end;
	}

	return { text: result, width };
}

function finalizeTruncatedResult(
	prefix: string,
	prefixWidth: number,
	ellipsis: string,
	ellipsisWidth: number,
	maxWidth: number,
	pad: boolean,
): string {
	const reset = "\x1b[0m";
	const resultVisibleWidth = prefixWidth + ellipsisWidth;
	let result: string;

	if (ellipsis.length > 0) {
		result = `${prefix}${reset}${ellipsis}${reset}`;
	} else {
		result = `${prefix}${reset}`;
	}

	return pad ? result + " ".repeat(Math.max(0, maxWidth - resultVisibleWidth)) : result;
}

/**
 * Truncate text to fit within a maximum visible width, adding ellipsis if needed.
 * Optionally pad with spaces to reach exactly maxWidth.
 * Properly handles ANSI escape codes (they don't count toward width).
 *
 * @param text - Text to truncate (may contain ANSI codes)
 * @param maxWidth - Maximum visible width
 * @param ellipsis - Ellipsis string to append when truncating (default: "...")
 * @param pad - If true, pad result with spaces to exactly maxWidth (default: false)
 * @returns Truncated text, optionally padded to exactly maxWidth
 */
export function truncateToWidth(
	text: string,
	maxWidth: number,
	ellipsis: string = "...",
	pad: boolean = false,
): string {
	if (maxWidth <= 0) {
		return "";
	}

	if (text.length === 0) {
		return pad ? " ".repeat(maxWidth) : "";
	}

	const segmenter = getSegmenter();
	const ellipsisWidth = visibleWidth(ellipsis);
	if (ellipsisWidth >= maxWidth) {
		const textWidth = visibleWidth(text);
		if (textWidth <= maxWidth) {
			return pad ? text + " ".repeat(maxWidth - textWidth) : text;
		}

		const clippedEllipsis = truncateFragmentToWidth(ellipsis, maxWidth);
		if (clippedEllipsis.width === 0) {
			return pad ? " ".repeat(maxWidth) : "";
		}
		return finalizeTruncatedResult("", 0, clippedEllipsis.text, clippedEllipsis.width, maxWidth, pad);
	}

	if (isPrintableAscii(text)) {
		if (text.length <= maxWidth) {
			return pad ? text + " ".repeat(maxWidth - text.length) : text;
		}
		const targetWidth = maxWidth - ellipsisWidth;
		return finalizeTruncatedResult(text.slice(0, targetWidth), targetWidth, ellipsis, ellipsisWidth, maxWidth, pad);
	}

	const targetWidth = maxWidth - ellipsisWidth;
	let result = "";
	let pendingAnsi = "";
	let visibleSoFar = 0;
	let keptWidth = 0;
	let keepContiguousPrefix = true;
	let overflowed = false;
	let exhaustedInput = false;
	const hasAnsi = text.includes("\x1b");
	const hasTabs = text.includes("\t");

	if (!hasAnsi && !hasTabs) {
		for (const { segment } of segmenter.segment(text)) {
			const width = graphemeWidth(segment);
			if (keepContiguousPrefix && keptWidth + width <= targetWidth) {
				result += segment;
				keptWidth += width;
			} else {
				keepContiguousPrefix = false;
			}
			visibleSoFar += width;
			if (visibleSoFar > maxWidth) {
				overflowed = true;
				break;
			}
		}
		exhaustedInput = !overflowed;
	} else {
		let i = 0;
		while (i < text.length) {
			const ansi = extractAnsiCode(text, i);
			if (ansi) {
				pendingAnsi += ansi.code;
				i += ansi.length;
				continue;
			}

			if (text[i] === "\t") {
				if (keepContiguousPrefix && keptWidth + 3 <= targetWidth) {
					if (pendingAnsi) {
						result += pendingAnsi;
						pendingAnsi = "";
					}
					result += "\t";
					keptWidth += 3;
				} else {
					keepContiguousPrefix = false;
					pendingAnsi = "";
				}
				visibleSoFar += 3;
				if (visibleSoFar > maxWidth) {
					overflowed = true;
					break;
				}
				i++;
				continue;
			}

			let end = i;
			while (end < text.length && text[end] !== "\t") {
				const nextAnsi = extractAnsiCode(text, end);
				if (nextAnsi) {
					break;
				}
				end++;
			}

			for (const { segment } of segmenter.segment(text.slice(i, end))) {
				const width = graphemeWidth(segment);
				if (keepContiguousPrefix && keptWidth + width <= targetWidth) {
					if (pendingAnsi) {
						result += pendingAnsi;
						pendingAnsi = "";
					}
					result += segment;
					keptWidth += width;
				} else {
					keepContiguousPrefix = false;
					pendingAnsi = "";
				}

				visibleSoFar += width;
				if (visibleSoFar > maxWidth) {
					overflowed = true;
					break;
				}
			}
			if (overflowed) {
				break;
			}
			i = end;
		}
		exhaustedInput = i >= text.length;
	}

	if (!overflowed && exhaustedInput) {
		return pad ? text + " ".repeat(Math.max(0, maxWidth - visibleSoFar)) : text;
	}

	return finalizeTruncatedResult(result, keptWidth, ellipsis, ellipsisWidth, maxWidth, pad);
}
