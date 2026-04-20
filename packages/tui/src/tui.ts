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
