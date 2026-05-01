/**
 * InteractiveMode shutdown helpers.
 *
 * The shutdown path tears down process-facing resources in a fixed order: signal
 * handlers, terminal progress, loaders, extension input listeners, footer data,
 * agent subscriptions, and finally the TUI. Keeping that order in one helper
 * avoids scattering cleanup side effects across command and signal handlers.
 */

import type { Loader, TUI } from "@mariozechner/pi-tui";
import type { FooterComponent } from "../components/footer.js";

export interface InteractiveLifecycleTarget {
	footer: FooterComponent;
	footerDataProvider: { dispose(): void };
	isInitialized: boolean;
	loadingAnimation: Loader | undefined;
	settingsManager: { getShowTerminalProgress(): boolean };
	ui: TUI;
	unsubscribe?: () => void;
	clearExtensionTerminalInputListeners(): void;
	unregisterSignalHandlers(): void;
}

/** Stop UI and session-owned subscriptions without disposing the runtime host. */
export function stopInteractiveMode(target: InteractiveLifecycleTarget): void {
	target.unregisterSignalHandlers();
	if (target.settingsManager.getShowTerminalProgress()) target.ui.terminal.setProgress(false);
	if (target.loadingAnimation) {
		target.loadingAnimation.stop();
		target.loadingAnimation = undefined;
	}
	target.clearExtensionTerminalInputListeners();
	target.footer.dispose();
	target.footerDataProvider.dispose();
	target.unsubscribe?.();
	if (target.isInitialized) {
		target.ui.stop();
		target.isInitialized = false;
	}
}
