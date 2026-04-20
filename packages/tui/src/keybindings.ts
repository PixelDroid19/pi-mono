/**
 * Compatibility shim — keybinding registry now lives in `input/keybindings.ts`.
 *
 * Internal consumers import from `"../keybindings.js"`. This shim re-exports
 * the canonical location so existing imports continue to resolve.
 * Do NOT remove until a separate approved deprecation change.
 */
export {
	getKeybindings,
	type Keybinding,
	type KeybindingConflict,
	type KeybindingDefinition,
	type KeybindingDefinitions,
	type Keybindings,
	type KeybindingsConfig,
	KeybindingsManager,
	setKeybindings,
	TUI_KEYBINDINGS,
} from "./input/keybindings.js";
