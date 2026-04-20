/**
 * Compatibility shim — text utilities now live in `text/`.
 *
 * Internal consumers import from `"../utils.js"`. This shim re-exports
 * the canonical locations so existing imports continue to resolve.
 * Do NOT remove until a separate approved deprecation change.
 */
export { extractAnsiCode } from "./text/ansi.js";
export { extractSegments, sliceByColumn, sliceWithWidth } from "./text/slice.js";
export { truncateToWidth } from "./text/truncate.js";
export {
	applyBackgroundToLine,
	getSegmenter,
	isPunctuationChar,
	isWhitespaceChar,
	visibleWidth,
} from "./text/width.js";
export { wrapTextWithAnsi } from "./text/wrap.js";
