/**
 * Public InteractiveMode facade.
 *
 * The TUI implementation lives in internal/interactive-mode-impl so startup,
 * selectors, session actions, extension UI, and rendering controllers can evolve
 * without changing the stable mode import path.
 */

export type { InteractiveModeOptions } from "./internal/interactive-mode-impl.js";
export {
	getApiKeyProviderDisplayName,
	InteractiveMode,
	isApiKeyLoginProvider,
} from "./internal/interactive-mode-impl.js";
