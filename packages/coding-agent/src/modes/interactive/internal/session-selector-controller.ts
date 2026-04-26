/**
 * Session selector controller for InteractiveMode.
 *
 * The controller owns selector construction, local/global session listing, and
 * rename wiring. Session switching stays in InteractiveMode because it rebuilds
 * runtime state and can require cwd recovery prompts.
 */

import type { Component } from "@mariozechner/pi-tui";
import type { KeybindingsManager } from "../../../core/keybindings.js";
import { SessionManager } from "../../../core/session-manager.js";
import { SessionSelectorComponent } from "../components/session-selector.js";

export interface SessionSelectorTarget {
	keybindings: KeybindingsManager;
	sessionManager: SessionManager;
	ui: { requestRender(): void };
	handleResumeSession(sessionPath: string): Promise<{ cancelled: boolean }>;
	showSelector(create: (done: () => void) => { component: Component; focus: Component }): void;
	shutdown(): Promise<void>;
}

/** Show the session selector and route chosen sessions back through InteractiveMode. */
export function showSessionSelector(target: SessionSelectorTarget): void {
	target.showSelector((done) => {
		const selector = new SessionSelectorComponent(
			(onProgress) =>
				SessionManager.list(target.sessionManager.getCwd(), target.sessionManager.getSessionDir(), onProgress),
			SessionManager.listAll,
			async (sessionPath) => {
				done();
				await target.handleResumeSession(sessionPath);
			},
			() => {
				done();
				target.ui.requestRender();
			},
			() => {
				void target.shutdown();
			},
			() => target.ui.requestRender(),
			{
				renameSession: async (sessionFilePath: string, nextName: string | undefined) => {
					const next = (nextName ?? "").trim();
					if (!next) return;
					const mgr = SessionManager.open(sessionFilePath);
					mgr.appendSessionInfo(next);
				},
				showRenameHint: true,
				keybindings: target.keybindings,
			},

			target.sessionManager.getSessionFile(),
		);
		return { component: selector, focus: selector };
	});
}
