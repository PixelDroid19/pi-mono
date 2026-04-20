// Core TUI interfaces and classes

// Autocomplete support
export {
	type AutocompleteItem,
	type AutocompleteProvider,
	type AutocompleteSuggestions,
	CombinedAutocompleteProvider,
	type SlashCommand,
} from "./autocomplete.js";
// Components
export { Box } from "./components/box.js";
export { CancellableLoader } from "./components/cancellable-loader.js";
export { Editor, type EditorOptions, type EditorTheme } from "./components/editor.js";
export { Image, type ImageOptions, type ImageTheme } from "./components/image.js";
export { Input } from "./components/input.js";
export { Loader } from "./components/loader.js";
export { type DefaultTextStyle, Markdown, type MarkdownTheme } from "./components/markdown.js";
export {
	type SelectItem,
	SelectList,
	type SelectListLayoutOptions,
	type SelectListTheme,
	type SelectListTruncatePrimaryContext,
} from "./components/select-list.js";
export { type SettingItem, SettingsList, type SettingsListTheme } from "./components/settings-list.js";
export { Spacer } from "./components/spacer.js";
export { Text } from "./components/text.js";
export { TruncatedText } from "./components/truncated-text.js";
export type {
	OverlayAnchor,
	OverlayHandle,
	OverlayMargin,
	OverlayOptions,
	SizeValue,
} from "./core/overlay.js";
export { ProcessTerminal, type Terminal } from "./core/terminal.js";
export { TUI } from "./core/tui.js";
export {
	type Component,
	Container,
	CURSOR_MARKER,
	type Focusable,
	isFocusable,
} from "./core/types.js";

// Editor component interface (for custom editors)
export type { EditorComponent } from "./editor-component.js";
// Keyboard input handling
export { Key, type KeyId } from "./input/key-types.js";

// Keybindings
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
export { isKittyProtocolActive, matchesKey, parseKey, setKittyProtocolActive } from "./input/keys.js";
export { decodeKittyPrintable } from "./input/kitty-printable.js";
export { isKeyRelease, isKeyRepeat, type KeyEventType } from "./input/kitty-protocol.js";
// Input buffering for batch splitting
export { StdinBuffer, type StdinBufferEventMap, type StdinBufferOptions } from "./input/stdin-buffer.js";
// Terminal image support
export {
	allocateImageId,
	type CellDimensions,
	calculateImageRows,
	deleteAllKittyImages,
	deleteKittyImage,
	detectCapabilities,
	encodeITerm2,
	encodeKitty,
	getCapabilities,
	getCellDimensions,
	getGifDimensions,
	getImageDimensions,
	getJpegDimensions,
	getPngDimensions,
	getWebpDimensions,
	hyperlink,
	type ImageDimensions,
	type ImageProtocol,
	type ImageRenderOptions,
	imageFallback,
	renderImage,
	resetCapabilitiesCache,
	setCapabilities,
	setCellDimensions,
	type TerminalCapabilities,
} from "./media/terminal-image.js";
// Fuzzy matching
export { type FuzzyMatch, fuzzyFilter, fuzzyMatch } from "./text/fuzzy.js";

// Text utilities
export { truncateToWidth } from "./text/truncate.js";
export { visibleWidth } from "./text/width.js";
export { wrapTextWithAnsi } from "./text/wrap.js";
