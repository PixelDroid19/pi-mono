/**
 * Compatibility shim — core TUI types moved to `core/` and `utils.ts`.
 *
 * Internal and external consumers import from `"../tui.js"`. This shim
 * re-exports the canonical locations so existing imports continue to
 * resolve. Do NOT remove until a separate approved deprecation change.
 */

// Re-export from new modular locations for backward compatibility

export type {
	OverlayAnchor,
	OverlayHandle,
	OverlayMargin,
	OverlayOptions,
	SizeValue,
} from "./core/overlay.js";
export { TUI } from "./core/tui.js";
export {
	type Component,
	Container,
	CURSOR_MARKER,
	type Focusable,
	type InputListener,
	type InputListenerResult,
	isFocusable,
} from "./core/types.js";
export { visibleWidth } from "./utils.js";
