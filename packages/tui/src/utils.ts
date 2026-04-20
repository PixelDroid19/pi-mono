/**
 * Re-export shim -- text utilities now live in text/.
 *
 * This file exists so that internal imports like `from "../utils.js"` continue
 * to resolve without updating every consumer.
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
