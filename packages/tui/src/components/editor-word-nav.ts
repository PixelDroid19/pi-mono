/**
 * Word-boundary movement helpers for the editor.
 *
 * Provides pure functions for computing the next cursor position when
 * moving forward or backward by word. Handles whitespace skipping,
 * punctuation runs, paste-marker atomicity, and grapheme-aware traversal.
 */

import { isPunctuationChar, isWhitespaceChar } from "../utils.js";
import { isPasteMarker } from "./editor-word-wrap.js";

/**
 * Compute the new cursor column after a backward-word movement.
 *
 * Scans graphemes from the cursor leftward, skipping trailing whitespace,
 * then skipping a punctuation run or a word-character run. Paste markers
 * are treated as single atomic words.
 *
 * @param graphemes - Pre-segmented graphemes of text before the cursor.
 * @param cursorCol - Current cursor column (byte offset in the logical line).
 * @returns The new cursor column after the word-backward movement.
 */
export function wordBoundaryBackward(graphemes: Intl.SegmentData[], cursorCol: number): number {
	// Work on a mutable copy so callers can reuse their array
	const segs = graphemes.slice();
	let newCol = cursorCol;

	// Skip trailing whitespace
	while (
		segs.length > 0 &&
		!isPasteMarker(segs[segs.length - 1]?.segment || "") &&
		isWhitespaceChar(segs[segs.length - 1]?.segment || "")
	) {
		newCol -= segs.pop()?.segment.length || 0;
	}

	if (segs.length > 0) {
		const lastGrapheme = segs[segs.length - 1]?.segment || "";
		if (isPasteMarker(lastGrapheme)) {
			// Paste marker is a single atomic word
			newCol -= segs.pop()?.segment.length || 0;
		} else if (isPunctuationChar(lastGrapheme)) {
			// Skip punctuation run
			while (
				segs.length > 0 &&
				isPunctuationChar(segs[segs.length - 1]?.segment || "") &&
				!isPasteMarker(segs[segs.length - 1]?.segment || "")
			) {
				newCol -= segs.pop()?.segment.length || 0;
			}
		} else {
			// Skip word run
			while (
				segs.length > 0 &&
				!isWhitespaceChar(segs[segs.length - 1]?.segment || "") &&
				!isPunctuationChar(segs[segs.length - 1]?.segment || "") &&
				!isPasteMarker(segs[segs.length - 1]?.segment || "")
			) {
				newCol -= segs.pop()?.segment.length || 0;
			}
		}
	}

	return newCol;
}

/**
 * Compute the new cursor column after a forward-word movement.
 *
 * Scans graphemes from the cursor rightward, skipping leading whitespace,
 * then skipping a punctuation run or a word-character run. Paste markers
 * are treated as single atomic words.
 *
 * @param segments - Iterable of grapheme segments of text after the cursor.
 * @param cursorCol - Current cursor column (byte offset in the logical line).
 * @returns The new cursor column after the word-forward movement.
 */
export function wordBoundaryForward(segments: Iterable<Intl.SegmentData>, cursorCol: number): number {
	const iterator = segments[Symbol.iterator]();
	let next = iterator.next();
	let newCol = cursorCol;

	// Skip leading whitespace
	while (!next.done && !isPasteMarker(next.value.segment) && isWhitespaceChar(next.value.segment)) {
		newCol += next.value.segment.length;
		next = iterator.next();
	}

	if (!next.done) {
		const firstGrapheme = next.value.segment;
		if (isPasteMarker(firstGrapheme)) {
			// Paste marker is a single atomic word
			newCol += firstGrapheme.length;
		} else if (isPunctuationChar(firstGrapheme)) {
			// Skip punctuation run
			while (!next.done && isPunctuationChar(next.value.segment) && !isPasteMarker(next.value.segment)) {
				newCol += next.value.segment.length;
				next = iterator.next();
			}
		} else {
			// Skip word run
			while (
				!next.done &&
				!isWhitespaceChar(next.value.segment) &&
				!isPunctuationChar(next.value.segment) &&
				!isPasteMarker(next.value.segment)
			) {
				newCol += next.value.segment.length;
				next = iterator.next();
			}
		}
	}

	return newCol;
}
