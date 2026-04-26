/**
 * Reload command controller for InteractiveMode.
 *
 * Reload touches extensions, resource loaders, themes, keybindings, editor
 * settings, and chat reconstruction. Keeping it here gives reload one explicit
 * contract instead of spreading those side effects through the main UI class.
 */

import type { Component, Container, EditorComponent, TUI } from "@mariozechner/pi-tui";
import { Spacer, Text, Container as TuiContainer } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { ExtensionRunner } from "../../../core/extensions/index.js";
import type { KeybindingsManager } from "../../../core/keybindings.js";
import type { SettingsManager } from "../../../core/settings-manager.js";
import type { CustomEditor } from "../components/custom-editor.js";
import { DynamicBorder } from "../components/dynamic-border.js";
import { setRegisteredThemes, setTheme, theme } from "../theme/theme.js";

interface ExpandableHeader {
	setExpanded(expanded: boolean): void;
}

function isExpandableHeader(value: unknown): value is ExpandableHeader {
	return (
		typeof value === "object" && value !== null && "setExpanded" in value && typeof value.setExpanded === "function"
	);
}

export interface ReloadCommandTarget {
	builtInHeader: unknown;
	customHeader: unknown;
	defaultEditor: CustomEditor;
	editor: EditorComponent;
	editorContainer: Container;
	hideThinkingBlock: boolean;
	keybindings: KeybindingsManager;
	session: AgentSession;
	settingsManager: SettingsManager;
	toolOutputExpanded: boolean;
	ui: TUI;
	rebuildChatFromMessages(): void;
	resetExtensionUI(): void;
	setupAutocompleteProvider(): void;
	setupExtensionShortcuts(runner: ExtensionRunner): void;
	showError(message: string): void;
	showLoadedResources(options: { force: boolean; showDiagnosticsWhenQuiet: boolean }): void;
	showStatus(message: string): void;
	showWarning(message: string): void;
}

/** Reload keybindings, extensions, resources, themes, editor settings, and chat UI. */
export async function handleReloadCommand(target: ReloadCommandTarget): Promise<void> {
	if (target.session.isStreaming) {
		target.showWarning("Wait for the current response to finish before reloading.");
		return;
	}
	if (target.session.isCompacting) {
		target.showWarning("Wait for compaction to finish before reloading.");
		return;
	}

	target.resetExtensionUI();

	const reloadBox = new TuiContainer();
	const borderColor = (s: string) => theme.fg("border", s);
	reloadBox.addChild(new DynamicBorder(borderColor));
	reloadBox.addChild(new Spacer(1));
	reloadBox.addChild(
		new Text(theme.fg("muted", "Reloading keybindings, extensions, skills, prompts, themes..."), 1, 0),
	);
	reloadBox.addChild(new Spacer(1));
	reloadBox.addChild(new DynamicBorder(borderColor));

	const previousEditor = target.editor;
	target.editorContainer.clear();
	target.editorContainer.addChild(reloadBox);
	target.ui.setFocus(reloadBox);
	target.ui.requestRender(true);
	await new Promise((resolve) => process.nextTick(resolve));

	const dismissReloadBox = (editor: Component) => {
		target.editorContainer.clear();
		target.editorContainer.addChild(editor);
		target.ui.setFocus(editor);
		target.ui.requestRender();
	};

	try {
		await target.session.reload();
		target.keybindings.reload();
		const activeHeader = target.customHeader ?? target.builtInHeader;
		if (isExpandableHeader(activeHeader)) {
			activeHeader.setExpanded(target.toolOutputExpanded);
		}
		setRegisteredThemes(target.session.resourceLoader.getThemes().themes);
		target.hideThinkingBlock = target.settingsManager.getHideThinkingBlock();
		const themeName = target.settingsManager.getTheme();
		const themeResult = themeName ? setTheme(themeName, true) : { success: true };
		if (!themeResult.success) {
			target.showError(`Failed to load theme "${themeName}": ${themeResult.error}\nFell back to dark theme.`);
		}
		const editorPaddingX = target.settingsManager.getEditorPaddingX();
		const autocompleteMaxVisible = target.settingsManager.getAutocompleteMaxVisible();
		target.defaultEditor.setPaddingX(editorPaddingX);
		target.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
		if (target.editor !== target.defaultEditor) {
			target.editor.setPaddingX?.(editorPaddingX);
			target.editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
		}
		target.ui.setShowHardwareCursor(target.settingsManager.getShowHardwareCursor());
		target.ui.setClearOnShrink(target.settingsManager.getClearOnShrink());
		target.setupAutocompleteProvider();
		const runner = target.session.extensionRunner;
		target.setupExtensionShortcuts(runner);
		target.rebuildChatFromMessages();
		dismissReloadBox(target.editor as Component);
		target.showLoadedResources({
			force: false,
			showDiagnosticsWhenQuiet: true,
		});
		const modelsJsonError = target.session.modelRegistry.getError();
		if (modelsJsonError) {
			target.showError(`models.json error: ${modelsJsonError}`);
		}
		target.showStatus("Reloaded keybindings, extensions, skills, prompts, themes");
	} catch (error) {
		dismissReloadBox(previousEditor as Component);
		target.showError(`Reload failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
