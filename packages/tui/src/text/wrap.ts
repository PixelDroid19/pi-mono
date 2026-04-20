/**
 * Word-aware text wrapping with ANSI code preservation.
 *
 * Wraps text at word boundaries, preserving ANSI SGR styles and OSC 8
 * hyperlinks across line breaks. Long unbreakable words are split at
 * the character level.
 */

import { AnsiCodeTracker, extractAnsiCode, updateTrackerFromText } from "./ansi.js";
import { getSegmenter, visibleWidth } from "./width.js";

/**
 * Split text into words while keeping ANSI codes attached.
 */
function splitIntoTokensWithAnsi(text: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let pendingAnsi = ""; // ANSI codes waiting to be attached to next visible content
	let inWhitespace = false;
	let i = 0;

	while (i < text.length) {
		const ansiResult = extractAnsiCode(text, i);
		if (ansiResult) {
			// Hold ANSI codes separately - they'll be attached to the next visible char
			pendingAnsi += ansiResult.code;
			i += ansiResult.length;
			continue;
		}

		const char = text[i];
		const charIsSpace = char === " ";

		if (charIsSpace !== inWhitespace && current) {
			// Switching between whitespace and non-whitespace, push current token
			tokens.push(current);
			current = "";
		}

		// Attach any pending ANSI codes to this visible character
		if (pendingAnsi) {
			current += pendingAnsi;
			pendingAnsi = "";
		}

		inWhitespace = charIsSpace;
		current += char;
		i++;
	}

	// Handle any remaining pending ANSI codes (attach to last token)
	if (pendingAnsi) {
		current += pendingAnsi;
	}

	if (current) {
		tokens.push(current);
	}

	return tokens;
}

/**
 * Wrap text with ANSI codes preserved.
 *
 * ONLY does word wrapping - NO padding, NO background colors.
 * Returns lines where each line is <= width visible chars.
 * Active ANSI codes are preserved across line breaks.
 *
 * @param text - Text to wrap (may contain ANSI codes and newlines)
 * @param width - Maximum visible width per line
 * @returns Array of wrapped lines (NOT padded to width)
 */
export function wrapTextWithAnsi(text: string, width: number): string[] {
	if (!text) {
		return [""];
	}

	// Handle newlines by processing each line separately
	// Track ANSI state across lines so styles carry over after literal newlines
	const inputLines = text.split("\n");
	const result: string[] = [];
	const tracker = new AnsiCodeTracker();

	for (const inputLine of inputLines) {
		// Prepend active ANSI codes from previous lines (except for first line)
		const prefix = result.length > 0 ? tracker.getActiveCodes() : "";
		result.push(...wrapSingleLine(prefix + inputLine, width));
		// Update tracker with codes from this line for next iteration
		updateTrackerFromText(inputLine, tracker);
	}

	return result.length > 0 ? result : [""];
}

function wrapSingleLine(line: string, width: number): string[] {
	if (!line) {
		return [""];
	}

	const visibleLength = visibleWidth(line);
	if (visibleLength <= width) {
		return [line];
	}

	const wrapped: string[] = [];
	const tracker = new AnsiCodeTracker();
	const tokens = splitIntoTokensWithAnsi(line);

	let currentLine = "";
	let currentVisibleLength = 0;

	for (const token of tokens) {
		const tokenVisibleLength = visibleWidth(token);
		const isWhitespace = token.trim() === "";

		// Token itself is too long - break it character by character
		if (tokenVisibleLength > width && !isWhitespace) {
			if (currentLine) {
				// Add specific reset for underline only (preserves background)
				const lineEndReset = tracker.getLineEndReset();
				if (lineEndReset) {
					currentLine += lineEndReset;
				}
				wrapped.push(currentLine);
				currentLine = "";
				currentVisibleLength = 0;
			}

			// Break long token - breakLongWord handles its own resets
			const broken = breakLongWord(token, width, tracker);
			wrapped.push(...broken.slice(0, -1));
			currentLine = broken[broken.length - 1];
			currentVisibleLength = visibleWidth(currentLine);
			continue;
		}

		// Check if adding this token would exceed width
		const totalNeeded = currentVisibleLength + tokenVisibleLength;

		if (totalNeeded > width && currentVisibleLength > 0) {
			// Trim trailing whitespace, then add underline reset (not full reset, to preserve background)
			let lineToWrap = currentLine.trimEnd();
			const lineEndReset = tracker.getLineEndReset();
			if (lineEndReset) {
				lineToWrap += lineEndReset;
			}
			wrapped.push(lineToWrap);
			if (isWhitespace) {
				// Don't start new line with whitespace
				currentLine = tracker.getActiveCodes();
				currentVisibleLength = 0;
			} else {
				currentLine = tracker.getActiveCodes() + token;
				currentVisibleLength = tokenVisibleLength;
			}
		} else {
			// Add to current line
			currentLine += token;
			currentVisibleLength += tokenVisibleLength;
		}

		updateTrackerFromText(token, tracker);
	}

	if (currentLine) {
		// No reset at end of final line - let caller handle it
		wrapped.push(currentLine);
	}

	// Trailing whitespace can cause lines to exceed the requested width
	return wrapped.length > 0 ? wrapped.map((line) => line.trimEnd()) : [""];
}

function breakLongWord(word: string, width: number, tracker: AnsiCodeTracker): string[] {
	const segmenter = getSegmenter();
	const lines: string[] = [];
	let currentLine = tracker.getActiveCodes();
	let currentWidth = 0;

	// First, separate ANSI codes from visible content
	// We need to handle ANSI codes specially since they're not graphemes
	let i = 0;
	const segments: Array<{ type: "ansi" | "grapheme"; value: string }> = [];

	while (i < word.length) {
		const ansiResult = extractAnsiCode(word, i);
		if (ansiResult) {
			segments.push({ type: "ansi", value: ansiResult.code });
			i += ansiResult.length;
		} else {
			// Find the next ANSI code or end of string
			let end = i;
			while (end < word.length) {
				const nextAnsi = extractAnsiCode(word, end);
				if (nextAnsi) break;
				end++;
			}
			// Segment this non-ANSI portion into graphemes
			const textPortion = word.slice(i, end);
			for (const seg of segmenter.segment(textPortion)) {
				segments.push({ type: "grapheme", value: seg.segment });
			}
			i = end;
		}
	}

	// Now process segments
	for (const seg of segments) {
		if (seg.type === "ansi") {
			currentLine += seg.value;
			tracker.process(seg.value);
			continue;
		}

		const grapheme = seg.value;
		// Skip empty graphemes to avoid issues with string-width calculation
		if (!grapheme) continue;

		const segmentWidth = visibleWidth(grapheme);

		if (currentWidth + segmentWidth > width) {
			// Add specific reset for underline only (preserves background)
			const lineEndReset = tracker.getLineEndReset();
			if (lineEndReset) {
				currentLine += lineEndReset;
			}
			lines.push(currentLine);
			currentLine = tracker.getActiveCodes();
			currentWidth = 0;
		}

		currentLine += grapheme;
		currentWidth += segmentWidth;
	}

	if (currentLine) {
		// No reset at end of final segment - caller handles continuation
		lines.push(currentLine);
	}

	return lines.length > 0 ? lines : [""];
}
