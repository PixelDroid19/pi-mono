/**
 * Terminal character width calculation, grapheme segmentation, and
 * text classification helpers.
 *
 * Provides visibleWidth() for measuring strings in terminal columns,
 * accounting for ANSI codes, wide characters, and emoji.
 */

import { eastAsianWidth } from "get-east-asian-width";
import { extractAnsiCode } from "./ansi.js";

// Grapheme segmenter (shared instance)
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Get the shared grapheme segmenter instance.
 */
export function getSegmenter(): Intl.Segmenter {
	return segmenter;
}

/**
 * Check if a grapheme cluster (after segmentation) could possibly be an RGI emoji.
 * This is a fast heuristic to avoid the expensive rgiEmojiRegex test.
 * The tested Unicode blocks are deliberately broad to account for future
 * Unicode additions.
 */
function couldBeEmoji(segment: string): boolean {
	const cp = segment.codePointAt(0)!;
	return (
		(cp >= 0x1f000 && cp <= 0x1fbff) || // Emoji and Pictograph
		(cp >= 0x2300 && cp <= 0x23ff) || // Misc technical
		(cp >= 0x2600 && cp <= 0x27bf) || // Misc symbols, dingbats
		(cp >= 0x2b50 && cp <= 0x2b55) || // Specific stars/circles
		segment.includes("\uFE0F") || // Contains VS16 (emoji presentation selector)
		segment.length > 2 // Multi-codepoint sequences (ZWJ, skin tones, etc.)
	);
}

// Regexes for character classification (same as string-width library)
const zeroWidthRegex = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/v;
const leadingNonPrintingRegex = /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]+/v;
const rgiEmojiRegex = /^\p{RGI_Emoji}$/v;

// Cache for non-ASCII strings
const WIDTH_CACHE_SIZE = 512;
const widthCache = new Map<string, number>();

export function isPrintableAscii(str: string): boolean {
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code < 0x20 || code > 0x7e) {
			return false;
		}
	}
	return true;
}

/**
 * Calculate the terminal width of a single grapheme cluster.
 * Based on code from the string-width library, but includes a possible-emoji
 * check to avoid running the RGI_Emoji regex unnecessarily.
 */
export function graphemeWidth(segment: string): number {
	// Zero-width clusters
	if (zeroWidthRegex.test(segment)) {
		return 0;
	}

	// Emoji check with pre-filter
	if (couldBeEmoji(segment) && rgiEmojiRegex.test(segment)) {
		return 2;
	}

	// Get base visible codepoint
	const base = segment.replace(leadingNonPrintingRegex, "");
	const cp = base.codePointAt(0);
	if (cp === undefined) {
		return 0;
	}

	// Regional indicator symbols (U+1F1E6..U+1F1FF) are often rendered as
	// full-width emoji in terminals, even when isolated during streaming.
	// Keep width conservative (2) to avoid terminal auto-wrap drift artifacts.
	if (cp >= 0x1f1e6 && cp <= 0x1f1ff) {
		return 2;
	}

	let width = eastAsianWidth(cp);

	// Trailing halfwidth/fullwidth forms
	if (segment.length > 1) {
		for (const char of segment.slice(1)) {
			const c = char.codePointAt(0)!;
			if (c >= 0xff00 && c <= 0xffef) {
				width += eastAsianWidth(c);
			}
		}
	}

	return width;
}

/**
 * Calculate the visible width of a string in terminal columns.
 */
export function visibleWidth(str: string): number {
	if (str.length === 0) {
		return 0;
	}

	// Fast path: pure ASCII printable
	if (isPrintableAscii(str)) {
		return str.length;
	}

	// Check cache
	const cached = widthCache.get(str);
	if (cached !== undefined) {
		return cached;
	}

	// Normalize: tabs to 3 spaces, strip ANSI escape codes
	let clean = str;
	if (str.includes("\t")) {
		clean = clean.replace(/\t/g, "   ");
	}
	if (clean.includes("\x1b")) {
		// Strip supported ANSI/OSC/APC escape sequences in one pass.
		// This covers CSI styling/cursor codes, OSC hyperlinks and prompt markers,
		// and APC sequences like CURSOR_MARKER.
		let stripped = "";
		let i = 0;
		while (i < clean.length) {
			const ansi = extractAnsiCode(clean, i);
			if (ansi) {
				i += ansi.length;
				continue;
			}
			stripped += clean[i];
			i++;
		}
		clean = stripped;
	}

	// Calculate width
	let width = 0;
	for (const { segment } of segmenter.segment(clean)) {
		width += graphemeWidth(segment);
	}

	// Cache result
	if (widthCache.size >= WIDTH_CACHE_SIZE) {
		const firstKey = widthCache.keys().next().value;
		if (firstKey !== undefined) {
			widthCache.delete(firstKey);
		}
	}
	widthCache.set(str, width);

	return width;
}

const PUNCTUATION_REGEX = /[(){}[\]<>.,;:'"!?+\-=*/\\|&%^$#@~`]/;

/**
 * Check if a character is whitespace.
 */
export function isWhitespaceChar(char: string): boolean {
	return /\s/.test(char);
}

/**
 * Check if a character is punctuation.
 */
export function isPunctuationChar(char: string): boolean {
	return PUNCTUATION_REGEX.test(char);
}

/**
 * Apply background color to a line, padding to full width.
 *
 * @param line - Line of text (may contain ANSI codes)
 * @param width - Total width to pad to
 * @param bgFn - Background color function
 * @returns Line with background applied and padded to width
 */
export function applyBackgroundToLine(line: string, width: number, bgFn: (text: string) => string): string {
	// Calculate padding needed
	const visibleLen = visibleWidth(line);
	const paddingNeeded = Math.max(0, width - visibleLen);
	const padding = " ".repeat(paddingNeeded);

	// Apply background to content + padding
	const withPadding = line + padding;
	return bgFn(withPadding);
}
