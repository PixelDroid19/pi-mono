/**
 * Session navigation selectors for InteractiveMode.
 *
 * This controller owns fork-from-message and tree navigation selectors, including
 * branch summary prompting, abort wiring, and post-navigation UI restoration.
 * Runtime rebinding still occurs through target callbacks owned by InteractiveMode.
 */

import type { Component, Container, EditorComponent, TUI } from "@mariozechner/pi-tui";
import { Loader, Spacer } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { AgentSessionRuntime } from "../../../core/agent-session-runtime.js";
import type { SessionManager } from "../../../core/session-manager.js";
import type { SettingsManager } from "../../../core/settings-manager.js";
import type { CustomEditor } from "../components/custom-editor.js";
import { keyText } from "../components/keybinding-hints.js";
import { TreeSelectorComponent } from "../components/tree-selector.js";
import { UserMessageSelectorComponent } from "../components/user-message-selector.js";
import { theme } from "../theme/theme.js";

export interface NavigationSelectorTarget {
	chatContainer: Container;
	defaultEditor: CustomEditor;
	editor: EditorComponent;
	runtimeHost: AgentSessionRuntime;
	session: AgentSession;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	statusContainer: Container;
	ui: TUI;
	flushCompactionQueue(options: { willRetry: boolean }): Promise<void>;
	renderCurrentSessionState(): void;
	renderInitialMessages(): void;
	showError(message: string): void;
	showExtensionEditor(title: string): Promise<string | undefined>;
	showExtensionSelector(title: string, options: string[]): Promise<string | undefined>;
	showSelector(create: (done: () => void) => { component: Component; focus: Component }): void;
	showStatus(message: string): void;
	showTreeSelector(initialSelectedId?: string): void;
}

/** Show the selector used by /fork to branch from an earlier user message. */
export function showUserMessageSelector(target: NavigationSelectorTarget): void {
	const userMessages = target.session.getUserMessagesForForking();

	if (userMessages.length === 0) {
		target.showStatus("No messages to fork from");
		return;
	}

	const initialSelectedId = userMessages[userMessages.length - 1]?.entryId;

	target.showSelector((done) => {
		const selector = new UserMessageSelectorComponent(
			userMessages.map((m) => ({ id: m.entryId, text: m.text })),
			async (entryId) => {
				try {
					const result = await target.runtimeHost.fork(entryId);
					if (result.cancelled) {
						done();
						target.ui.requestRender();
						return;
					}

					target.renderCurrentSessionState();
					target.editor.setText(result.selectedText ?? "");
					done();
					target.showStatus("Forked to new session");
				} catch (error: unknown) {
					done();
					target.showError(error instanceof Error ? error.message : String(error));
				}
			},
			() => {
				done();
				target.ui.requestRender();
			},
			initialSelectedId,
		);
		return { component: selector, focus: selector.getMessageList() };
	});
}

/** Show the conversation tree selector and navigate to the selected entry. */
export function showTreeSelector(target: NavigationSelectorTarget, initialSelectedId?: string): void {
	const tree = target.sessionManager.getTree();
	const realLeafId = target.sessionManager.getLeafId();
	const initialFilterMode = target.settingsManager.getTreeFilterMode();

	if (tree.length === 0) {
		target.showStatus("No entries in session");
		return;
	}

	target.showSelector((done) => {
		const selector = new TreeSelectorComponent(
			tree,
			realLeafId,
			target.ui.terminal.rows,
			async (entryId) => {
				// Selecting the current leaf is a no-op (already there)
				if (entryId === realLeafId) {
					done();
					target.showStatus("Already at this point");
					return;
				}

				// Ask about summarization
				done(); // Close selector first

				// Loop until user makes a complete choice or cancels to tree
				let wantsSummary = false;
				let customInstructions: string | undefined;

				// Check if we should skip the prompt (user preference to always default to no summary)
				if (!target.settingsManager.getBranchSummarySkipPrompt()) {
					while (true) {
						const summaryChoice = await target.showExtensionSelector("Summarize branch?", [
							"No summary",
							"Summarize",
							"Summarize with custom prompt",
						]);

						if (summaryChoice === undefined) {
							// User pressed escape - re-show tree selector with same selection
							target.showTreeSelector(entryId);
							return;
						}

						wantsSummary = summaryChoice !== "No summary";

						if (summaryChoice === "Summarize with custom prompt") {
							customInstructions = await target.showExtensionEditor("Custom summarization instructions");
							if (customInstructions === undefined) {
								// User cancelled - loop back to summary selector
								continue;
							}
						}

						// User made a complete choice
						break;
					}
				}

				// Set up escape handler and loader if summarizing
				let summaryLoader: Loader | undefined;
				const originalOnEscape = target.defaultEditor.onEscape;

				if (wantsSummary) {
					target.defaultEditor.onEscape = () => {
						target.session.abortBranchSummary();
					};
					target.chatContainer.addChild(new Spacer(1));
					summaryLoader = new Loader(
						target.ui,
						(spinner) => theme.fg("accent", spinner),
						(text) => theme.fg("muted", text),
						`Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
					);
					target.statusContainer.addChild(summaryLoader);
					target.ui.requestRender();
				}

				try {
					const result = await target.session.navigateTree(entryId, {
						summarize: wantsSummary,
						customInstructions,
					});

					if (result.aborted) {
						// Summarization aborted - re-show tree selector with same selection
						target.showStatus("Branch summarization cancelled");
						target.showTreeSelector(entryId);
						return;
					}
					if (result.cancelled) {
						target.showStatus("Navigation cancelled");
						return;
					}

					// Update UI
					target.chatContainer.clear();
					target.renderInitialMessages();
					if (result.editorText && !target.editor.getText().trim()) {
						target.editor.setText(result.editorText);
					}
					target.showStatus("Navigated to selected point");
					void target.flushCompactionQueue({ willRetry: false });
				} catch (error) {
					target.showError(error instanceof Error ? error.message : String(error));
				} finally {
					if (summaryLoader) {
						summaryLoader.stop();
						target.statusContainer.clear();
					}
					target.defaultEditor.onEscape = originalOnEscape;
				}
			},
			() => {
				done();
				target.ui.requestRender();
			},
			(entryId, label) => {
				target.sessionManager.appendLabelChange(entryId, label);
				target.ui.requestRender();
			},
			initialSelectedId,
			initialFilterMode,
		);
		return { component: selector, focus: selector };
	});
}
