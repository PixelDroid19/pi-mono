/**
 * Settings selector controller for InteractiveMode.
 *
 * The controller builds the settings selector and applies each setting's runtime
 * side effect. InteractiveMode remains responsible for owning UI state; this
 * module keeps settings-specific mutations out of the main class.
 */

import type { Component, Container, EditorComponent, TUI } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { SettingsManager } from "../../../core/settings-manager.js";
import { AssistantMessageComponent } from "../components/assistant-message.js";
import type { CustomEditor } from "../components/custom-editor.js";
import type { FooterComponent } from "../components/footer.js";
import { SettingsSelectorComponent } from "../components/settings-selector.js";
import { ToolExecutionComponent } from "../components/tool-execution.js";
import { getAvailableThemes, setTheme } from "../theme/theme.js";

export interface SettingsSelectorTarget {
	chatContainer: Container;
	defaultEditor: CustomEditor;
	editor: EditorComponent;
	footer: FooterComponent;
	hideThinkingBlock: boolean;
	session: AgentSession;
	settingsManager: SettingsManager;
	ui: TUI;
	rebuildChatFromMessages(): void;
	setupAutocompleteProvider(): void;
	showError(message: string): void;
	showSelector(create: (done: () => void) => { component: Component; focus: Component }): void;
	updateEditorBorderColor(): void;
}

/** Show the settings selector and wire every setting to its runtime side effect. */
export function showSettingsSelector(target: SettingsSelectorTarget): void {
	target.showSelector((done) => {
		const selector = new SettingsSelectorComponent(
			{
				autoCompact: target.session.autoCompactionEnabled,
				showImages: target.settingsManager.getShowImages(),
				imageWidthCells: target.settingsManager.getImageWidthCells(),
				autoResizeImages: target.settingsManager.getImageAutoResize(),
				blockImages: target.settingsManager.getBlockImages(),
				steeringMode: target.session.steeringMode,
				followUpMode: target.session.followUpMode,
				transport: target.settingsManager.getTransport(),
				thinkingLevel: target.session.thinkingLevel,
				availableThinkingLevels: target.session.getAvailableThinkingLevels(),
				currentTheme: target.settingsManager.getTheme() || "dark",
				availableThemes: getAvailableThemes(),
				hideThinkingBlock: target.hideThinkingBlock,
				collapseChangelog: target.settingsManager.getCollapseChangelog(),
				enableInstallTelemetry: target.settingsManager.getEnableInstallTelemetry(),
				doubleEscapeAction: target.settingsManager.getDoubleEscapeAction(),
				treeFilterMode: target.settingsManager.getTreeFilterMode(),
				showHardwareCursor: target.settingsManager.getShowHardwareCursor(),
				editorPaddingX: target.settingsManager.getEditorPaddingX(),
				autocompleteMaxVisible: target.settingsManager.getAutocompleteMaxVisible(),
				quietStartup: target.settingsManager.getQuietStartup(),
				clearOnShrink: target.settingsManager.getClearOnShrink(),
				showTerminalProgress: target.settingsManager.getShowTerminalProgress(),
				enableSkillCommands: target.settingsManager.getEnableSkillCommands(),
			},
			{
				onAutoCompactChange: (enabled) => {
					target.session.setAutoCompactionEnabled(enabled);
					target.footer.setAutoCompactEnabled(enabled);
				},
				onShowImagesChange: (enabled) => {
					target.settingsManager.setShowImages(enabled);
					for (const child of target.chatContainer.children) {
						if (child instanceof ToolExecutionComponent) {
							child.setShowImages(enabled);
						}
					}
				},
				onImageWidthCellsChange: (width) => {
					target.settingsManager.setImageWidthCells(width);
					for (const child of target.chatContainer.children) {
						if (child instanceof ToolExecutionComponent) {
							child.setImageWidthCells(width);
						}
					}
				},
				onAutoResizeImagesChange: (enabled) => {
					target.settingsManager.setImageAutoResize(enabled);
				},
				onBlockImagesChange: (blocked) => {
					target.settingsManager.setBlockImages(blocked);
				},
				onEnableSkillCommandsChange: (enabled) => {
					target.settingsManager.setEnableSkillCommands(enabled);
					target.setupAutocompleteProvider();
				},
				onSteeringModeChange: (mode) => {
					target.session.setSteeringMode(mode);
				},
				onFollowUpModeChange: (mode) => {
					target.session.setFollowUpMode(mode);
				},
				onTransportChange: (transport) => {
					target.settingsManager.setTransport(transport);
					target.session.agent.transport = transport;
				},
				onThinkingLevelChange: (level) => {
					target.session.setThinkingLevel(level);
					target.footer.invalidate();
					target.updateEditorBorderColor();
				},
				onThemeChange: (themeName) => {
					const result = setTheme(themeName, true);
					target.settingsManager.setTheme(themeName);
					target.ui.invalidate();
					if (!result.success) {
						target.showError(`Failed to load theme "${themeName}": ${result.error}\nFell back to dark theme.`);
					}
				},
				onThemePreview: (themeName) => {
					const result = setTheme(themeName, true);
					if (result.success) {
						target.ui.invalidate();
						target.ui.requestRender();
					}
				},
				onHideThinkingBlockChange: (hidden) => {
					target.hideThinkingBlock = hidden;
					target.settingsManager.setHideThinkingBlock(hidden);
					for (const child of target.chatContainer.children) {
						if (child instanceof AssistantMessageComponent) {
							child.setHideThinkingBlock(hidden);
						}
					}
					target.chatContainer.clear();
					target.rebuildChatFromMessages();
				},
				onCollapseChangelogChange: (collapsed) => {
					target.settingsManager.setCollapseChangelog(collapsed);
				},
				onEnableInstallTelemetryChange: (enabled) => {
					target.settingsManager.setEnableInstallTelemetry(enabled);
				},
				onQuietStartupChange: (enabled) => {
					target.settingsManager.setQuietStartup(enabled);
				},
				onDoubleEscapeActionChange: (action) => {
					target.settingsManager.setDoubleEscapeAction(action);
				},
				onTreeFilterModeChange: (mode) => {
					target.settingsManager.setTreeFilterMode(mode);
				},
				onShowHardwareCursorChange: (enabled) => {
					target.settingsManager.setShowHardwareCursor(enabled);
					target.ui.setShowHardwareCursor(enabled);
				},
				onEditorPaddingXChange: (padding) => {
					target.settingsManager.setEditorPaddingX(padding);
					target.defaultEditor.setPaddingX(padding);
					if (target.editor !== target.defaultEditor && target.editor.setPaddingX !== undefined) {
						target.editor.setPaddingX(padding);
					}
				},
				onAutocompleteMaxVisibleChange: (maxVisible) => {
					target.settingsManager.setAutocompleteMaxVisible(maxVisible);
					target.defaultEditor.setAutocompleteMaxVisible(maxVisible);
					if (target.editor !== target.defaultEditor && target.editor.setAutocompleteMaxVisible !== undefined) {
						target.editor.setAutocompleteMaxVisible(maxVisible);
					}
				},
				onClearOnShrinkChange: (enabled) => {
					target.settingsManager.setClearOnShrink(enabled);
					target.ui.setClearOnShrink(enabled);
				},
				onShowTerminalProgressChange: (enabled) => {
					target.settingsManager.setShowTerminalProgress(enabled);
				},
				onCancel: () => {
					done();
					target.ui.requestRender();
				},
			},
		);
		return { component: selector, focus: selector.getSettingsList() };
	});
}
