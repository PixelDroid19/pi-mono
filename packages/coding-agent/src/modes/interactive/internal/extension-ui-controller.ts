/**
 * Extension UI controller for InteractiveMode.
 *
 * Extensions are allowed to replace focused editor surfaces, render dialogs,
 * attach widgets around the editor, override header/footer components, and
 * listen to raw terminal input. Keeping those mutations in this module gives
 * InteractiveMode a narrow host contract and makes extension-driven UI state
 * easier to test independently from the full TUI runtime.
 */

import type {
	AutocompleteProvider,
	Component,
	EditorComponent,
	EditorTheme,
	LoaderIndicatorOptions,
	OverlayHandle,
	OverlayOptions,
	TUI,
} from "@mariozechner/pi-tui";
import { Container, Loader, Spacer, Text } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
} from "../../../core/extensions/index.js";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.js";
import type { KeybindingsManager } from "../../../core/keybindings.js";
import type { SettingsManager } from "../../../core/settings-manager.js";
import { AssistantMessageComponent } from "../components/assistant-message.js";
import type { CustomEditor } from "../components/custom-editor.js";
import { isExpandable } from "../components/expandable-text.js";
import { ExtensionEditorComponent } from "../components/extension-editor.js";
import { ExtensionInputComponent } from "../components/extension-input.js";
import { ExtensionSelectorComponent } from "../components/extension-selector.js";
import type { FooterComponent } from "../components/footer.js";
import { keyText } from "../components/keybinding-hints.js";
import {
	getAvailableThemesWithPaths,
	getEditorTheme,
	getThemeByName,
	setTheme,
	setThemeInstance,
	Theme,
	theme,
} from "../theme/theme.js";
import { disposeWidget, renderWidgetContainer as renderWidgetContainerContents } from "./extension-ui.js";

const MAX_WIDGET_LINES = 10;

export type DisposableComponent = Component & { dispose?(): void };

/** Host state and callbacks required to mutate extension-owned UI surfaces. */
export interface ExtensionUiTarget {
	autocompleteProvider: AutocompleteProvider | undefined;
	autocompleteProviderWrappers: Array<(provider: AutocompleteProvider) => AutocompleteProvider>;
	builtInHeader: Component | undefined;
	chatContainer: Container;
	customFooter: DisposableComponent | undefined;
	customHeader: DisposableComponent | undefined;
	defaultEditor: CustomEditor;
	defaultHiddenThinkingLabel: string;
	defaultWorkingMessage: string;
	editor: EditorComponent;
	editorContainer: Container;
	extensionEditor: ExtensionEditorComponent | undefined;
	extensionInput: ExtensionInputComponent | undefined;
	extensionSelector: ExtensionSelectorComponent | undefined;
	extensionTerminalInputUnsubscribers: Set<() => void>;
	extensionWidgetsAbove: Map<string, DisposableComponent>;
	extensionWidgetsBelow: Map<string, DisposableComponent>;
	footer: FooterComponent;
	footerDataProvider: ReadonlyFooterDataProvider & {
		setExtensionStatus(key: string, text: string | undefined): void;
		clearExtensionStatuses(): void;
	};
	headerContainer: Container;
	hiddenThinkingLabel: string;
	keybindings: KeybindingsManager;
	loadingAnimation: Loader | undefined;
	settingsManager: SettingsManager;
	session: AgentSession;
	statusContainer: Container;
	streamingComponent: AssistantMessageComponent | undefined;
	toolOutputExpanded: boolean;
	ui: TUI;
	widgetContainerAbove: Container;
	widgetContainerBelow: Container;
	workingIndicatorOptions: LoaderIndicatorOptions | undefined;
	workingMessage: string | undefined;
	workingVisible: boolean;
	setToolsExpanded(expanded: boolean): void;
	setupAutocompleteProvider(): void;
	showError(message: string): void;
	showStatus(message: string): void;
	showWarning(message: string): void;
	updateTerminalTitle(): void;
}

export function setExtensionStatus(target: ExtensionUiTarget, key: string, text: string | undefined): void {
	target.footerDataProvider.setExtensionStatus(key, text);
	target.ui.requestRender();
}

export function getWorkingLoaderMessage(target: ExtensionUiTarget): string {
	return target.workingMessage ?? target.defaultWorkingMessage;
}

export function createWorkingLoader(target: ExtensionUiTarget): Loader {
	return new Loader(
		target.ui,
		(spinner) => theme.fg("accent", spinner),
		(text) => theme.fg("muted", text),
		getWorkingLoaderMessage(target),
		target.workingIndicatorOptions,
	);
}

export function stopWorkingLoader(target: ExtensionUiTarget): void {
	if (target.loadingAnimation) {
		target.loadingAnimation.stop();
		target.loadingAnimation = undefined;
	}
	target.statusContainer.clear();
}

export function setWorkingVisible(target: ExtensionUiTarget, visible: boolean): void {
	target.workingVisible = visible;
	if (!visible) {
		stopWorkingLoader(target);
		target.ui.requestRender();
		return;
	}
	if (target.session.isStreaming && !target.loadingAnimation) {
		target.statusContainer.clear();
		target.loadingAnimation = createWorkingLoader(target);
		target.statusContainer.addChild(target.loadingAnimation);
	}
	target.ui.requestRender();
}

export function setWorkingIndicator(target: ExtensionUiTarget, options?: LoaderIndicatorOptions): void {
	target.workingIndicatorOptions = options;
	target.loadingAnimation?.setIndicator(options);
	target.ui.requestRender();
}

export function setHiddenThinkingLabel(target: ExtensionUiTarget, label?: string): void {
	target.hiddenThinkingLabel = label ?? target.defaultHiddenThinkingLabel;
	for (const child of target.chatContainer.children) {
		if (child instanceof AssistantMessageComponent) {
			child.setHiddenThinkingLabel(target.hiddenThinkingLabel);
		}
	}
	target.streamingComponent?.setHiddenThinkingLabel(target.hiddenThinkingLabel);
	target.ui.requestRender();
}

export function setExtensionWidget(
	target: ExtensionUiTarget,
	key: string,
	content: string[] | ((tui: TUI, thm: Theme) => DisposableComponent) | undefined,
	options?: ExtensionWidgetOptions,
): void {
	const placement = options?.placement ?? "aboveEditor";
	disposeWidget(target.extensionWidgetsAbove, key);
	disposeWidget(target.extensionWidgetsBelow, key);

	if (content === undefined) {
		renderWidgets(target);
		return;
	}

	let component: DisposableComponent;
	if (Array.isArray(content)) {
		const container = new Container();
		for (const line of content.slice(0, MAX_WIDGET_LINES)) {
			container.addChild(new Text(line, 1, 0));
		}
		if (content.length > MAX_WIDGET_LINES) {
			container.addChild(new Text(theme.fg("muted", "... (widget truncated)"), 1, 0));
		}
		component = container;
	} else {
		component = content(target.ui, theme);
	}

	const targetMap = placement === "belowEditor" ? target.extensionWidgetsBelow : target.extensionWidgetsAbove;
	targetMap.set(key, component);
	renderWidgets(target);
}

export function clearExtensionWidgets(target: ExtensionUiTarget): void {
	for (const widget of target.extensionWidgetsAbove.values()) widget.dispose?.();
	for (const widget of target.extensionWidgetsBelow.values()) widget.dispose?.();
	target.extensionWidgetsAbove.clear();
	target.extensionWidgetsBelow.clear();
	renderWidgets(target);
}

export function resetExtensionUI(target: ExtensionUiTarget): void {
	if (target.extensionSelector) hideExtensionSelector(target);
	if (target.extensionInput) hideExtensionInput(target);
	if (target.extensionEditor) hideExtensionEditor(target);
	target.ui.hideOverlay();
	clearExtensionTerminalInputListeners(target);
	setExtensionFooter(target, undefined);
	setExtensionHeader(target, undefined);
	clearExtensionWidgets(target);
	target.footerDataProvider.clearExtensionStatuses();
	target.footer.invalidate();
	target.autocompleteProviderWrappers = [];
	setCustomEditorComponent(target, undefined);
	target.setupAutocompleteProvider();
	target.defaultEditor.onExtensionShortcut = undefined;
	target.updateTerminalTitle();
	target.workingMessage = undefined;
	target.workingVisible = true;
	setWorkingIndicator(target);
	if (target.loadingAnimation) {
		target.loadingAnimation.setMessage(`${target.defaultWorkingMessage} (${keyText("app.interrupt")} to interrupt)`);
	}
	setHiddenThinkingLabel(target);
}

export function renderWidgets(target: ExtensionUiTarget): void {
	renderWidgetContainer(target, target.widgetContainerAbove, target.extensionWidgetsAbove, true, true);
	renderWidgetContainer(target, target.widgetContainerBelow, target.extensionWidgetsBelow, false, false);
	target.ui.requestRender();
}

export function renderWidgetContainer(
	_target: ExtensionUiTarget,
	container: Container,
	widgets: Map<string, DisposableComponent>,
	spacerWhenEmpty: boolean,
	leadingSpacer: boolean,
): void {
	renderWidgetContainerContents(container, widgets, {
		spacerWhenEmpty,
		leadingSpacer,
		createSpacer: (height) => new Spacer(height),
	});
}

export function setExtensionFooter(
	target: ExtensionUiTarget,
	factory: ((tui: TUI, thm: Theme, footerData: ReadonlyFooterDataProvider) => DisposableComponent) | undefined,
): void {
	target.customFooter?.dispose?.();
	target.ui.removeChild(target.customFooter ?? target.footer);

	if (factory) {
		target.customFooter = factory(target.ui, theme, target.footerDataProvider);
		target.ui.addChild(target.customFooter);
	} else {
		target.customFooter = undefined;
		target.ui.addChild(target.footer);
	}

	target.ui.requestRender();
}

export function setExtensionHeader(
	target: ExtensionUiTarget,
	factory: ((tui: TUI, thm: Theme) => DisposableComponent) | undefined,
): void {
	if (!target.builtInHeader) return;
	target.customHeader?.dispose?.();

	const currentHeader = target.customHeader || target.builtInHeader;
	const index = target.headerContainer.children.indexOf(currentHeader);

	if (factory) {
		target.customHeader = factory(target.ui, theme);
		if (isExpandable(target.customHeader)) target.customHeader.setExpanded(target.toolOutputExpanded);
		if (index !== -1) target.headerContainer.children[index] = target.customHeader;
		else target.headerContainer.children.unshift(target.customHeader);
	} else {
		target.customHeader = undefined;
		if (isExpandable(target.builtInHeader)) target.builtInHeader.setExpanded(target.toolOutputExpanded);
		if (index !== -1) target.headerContainer.children[index] = target.builtInHeader;
	}

	target.ui.requestRender();
}

export function addExtensionTerminalInputListener(
	target: ExtensionUiTarget,
	handler: (data: string) => { consume?: boolean; data?: string } | undefined,
): () => void {
	const unsubscribe = target.ui.addInputListener(handler);
	target.extensionTerminalInputUnsubscribers.add(unsubscribe);
	return () => {
		unsubscribe();
		target.extensionTerminalInputUnsubscribers.delete(unsubscribe);
	};
}

export function clearExtensionTerminalInputListeners(target: ExtensionUiTarget): void {
	for (const unsubscribe of target.extensionTerminalInputUnsubscribers) unsubscribe();
	target.extensionTerminalInputUnsubscribers.clear();
}

export function createExtensionUIContext(target: ExtensionUiTarget): ExtensionUIContext {
	return {
		select: (title, options, opts) => showExtensionSelector(target, title, options, opts),
		confirm: (title, message, opts) => showExtensionConfirm(target, title, message, opts),
		input: (title, placeholder, opts) => showExtensionInput(target, title, placeholder, opts),
		notify: (message, type) => showExtensionNotify(target, message, type),
		onTerminalInput: (handler) => addExtensionTerminalInputListener(target, handler),
		setStatus: (key, text) => setExtensionStatus(target, key, text),
		setWorkingMessage: (message) => {
			target.workingMessage = message;
			target.loadingAnimation?.setMessage(message ?? target.defaultWorkingMessage);
		},
		setWorkingVisible: (visible) => setWorkingVisible(target, visible),
		setWorkingIndicator: (options) => setWorkingIndicator(target, options),
		setHiddenThinkingLabel: (label) => setHiddenThinkingLabel(target, label),
		setWidget: (key, content, options) => setExtensionWidget(target, key, content, options),
		setFooter: (factory) => setExtensionFooter(target, factory),
		setHeader: (factory) => setExtensionHeader(target, factory),
		setTitle: (title) => target.ui.terminal.setTitle(title),
		custom: (factory, options) => showExtensionCustom(target, factory, options),
		pasteToEditor: (text) => target.editor.handleInput(`\x1b[200~${text}\x1b[201~`),
		setEditorText: (text) => target.editor.setText(text),
		getEditorText: () => target.editor.getExpandedText?.() ?? target.editor.getText(),
		editor: (title, prefill) => showExtensionEditor(target, title, prefill),
		addAutocompleteProvider: (factory) => {
			target.autocompleteProviderWrappers.push(factory);
			target.setupAutocompleteProvider();
		},
		setEditorComponent: (factory) => setCustomEditorComponent(target, factory),
		get theme() {
			return theme;
		},
		getAllThemes: () => getAvailableThemesWithPaths(),
		getTheme: (name) => getThemeByName(name),
		setTheme: (themeOrName) => {
			if (themeOrName instanceof Theme) {
				setThemeInstance(themeOrName);
				target.ui.requestRender();
				return { success: true };
			}
			const result = setTheme(themeOrName, true);
			if (result.success) {
				if (target.settingsManager.getTheme() !== themeOrName) target.settingsManager.setTheme(themeOrName);
				target.ui.requestRender();
			}
			return result;
		},
		getToolsExpanded: () => target.toolOutputExpanded,
		setToolsExpanded: (expanded) => target.setToolsExpanded(expanded),
	};
}

export function showExtensionSelector(
	target: ExtensionUiTarget,
	title: string,
	options: string[],
	opts?: ExtensionUIDialogOptions,
): Promise<string | undefined> {
	return new Promise((resolve) => {
		if (opts?.signal?.aborted) {
			resolve(undefined);
			return;
		}

		const onAbort = () => {
			hideExtensionSelector(target);
			resolve(undefined);
		};
		opts?.signal?.addEventListener("abort", onAbort, { once: true });

		target.extensionSelector = new ExtensionSelectorComponent(
			title,
			options,
			(option) => {
				opts?.signal?.removeEventListener("abort", onAbort);
				hideExtensionSelector(target);
				resolve(option);
			},
			() => {
				opts?.signal?.removeEventListener("abort", onAbort);
				hideExtensionSelector(target);
				resolve(undefined);
			},
			{ tui: target.ui, timeout: opts?.timeout },
		);

		target.editorContainer.clear();
		target.editorContainer.addChild(target.extensionSelector);
		target.ui.setFocus(target.extensionSelector);
		target.ui.requestRender();
	});
}

export function hideExtensionSelector(target: ExtensionUiTarget): void {
	target.extensionSelector?.dispose();
	target.editorContainer.clear();
	target.editorContainer.addChild(target.editor);
	target.extensionSelector = undefined;
	target.ui.setFocus(target.editor);
	target.ui.requestRender();
}

export async function showExtensionConfirm(
	target: ExtensionUiTarget,
	title: string,
	message: string,
	opts?: ExtensionUIDialogOptions,
): Promise<boolean> {
	const result = await showExtensionSelector(target, `${title}\n${message}`, ["Yes", "No"], opts);
	return result === "Yes";
}

export function showExtensionInput(
	target: ExtensionUiTarget,
	title: string,
	placeholder?: string,
	opts?: ExtensionUIDialogOptions,
): Promise<string | undefined> {
	return new Promise((resolve) => {
		if (opts?.signal?.aborted) {
			resolve(undefined);
			return;
		}

		const onAbort = () => {
			hideExtensionInput(target);
			resolve(undefined);
		};
		opts?.signal?.addEventListener("abort", onAbort, { once: true });

		target.extensionInput = new ExtensionInputComponent(
			title,
			placeholder,
			(value) => {
				opts?.signal?.removeEventListener("abort", onAbort);
				hideExtensionInput(target);
				resolve(value);
			},
			() => {
				opts?.signal?.removeEventListener("abort", onAbort);
				hideExtensionInput(target);
				resolve(undefined);
			},
			{ tui: target.ui, timeout: opts?.timeout },
		);

		target.editorContainer.clear();
		target.editorContainer.addChild(target.extensionInput);
		target.ui.setFocus(target.extensionInput);
		target.ui.requestRender();
	});
}

export function hideExtensionInput(target: ExtensionUiTarget): void {
	target.extensionInput?.dispose();
	target.editorContainer.clear();
	target.editorContainer.addChild(target.editor);
	target.extensionInput = undefined;
	target.ui.setFocus(target.editor);
	target.ui.requestRender();
}

export function showExtensionEditor(
	target: ExtensionUiTarget,
	title: string,
	prefill?: string,
): Promise<string | undefined> {
	return new Promise((resolve) => {
		target.extensionEditor = new ExtensionEditorComponent(
			target.ui,
			target.keybindings,
			title,
			prefill,
			(value) => {
				hideExtensionEditor(target);
				resolve(value);
			},
			() => {
				hideExtensionEditor(target);
				resolve(undefined);
			},
		);

		target.editorContainer.clear();
		target.editorContainer.addChild(target.extensionEditor);
		target.ui.setFocus(target.extensionEditor);
		target.ui.requestRender();
	});
}

export function hideExtensionEditor(target: ExtensionUiTarget): void {
	target.editorContainer.clear();
	target.editorContainer.addChild(target.editor);
	target.extensionEditor = undefined;
	target.ui.setFocus(target.editor);
	target.ui.requestRender();
}

export function setCustomEditorComponent(
	target: ExtensionUiTarget,
	factory: ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent) | undefined,
): void {
	const currentText = target.editor.getText();
	target.editorContainer.clear();

	if (factory) {
		const newEditor = factory(target.ui, getEditorTheme(), target.keybindings);
		newEditor.onSubmit = target.defaultEditor.onSubmit;
		newEditor.onChange = target.defaultEditor.onChange;
		newEditor.setText(currentText);
		if (newEditor.borderColor !== undefined) newEditor.borderColor = target.defaultEditor.borderColor;
		newEditor.setPaddingX?.(target.defaultEditor.getPaddingX());
		if (newEditor.setAutocompleteProvider && target.autocompleteProvider)
			newEditor.setAutocompleteProvider(target.autocompleteProvider);

		const customEditor = newEditor as unknown as Record<string, unknown>;
		if ("actionHandlers" in customEditor && customEditor.actionHandlers instanceof Map) {
			if (!customEditor.onEscape) customEditor.onEscape = () => target.defaultEditor.onEscape?.();
			if (!customEditor.onCtrlD) customEditor.onCtrlD = () => target.defaultEditor.onCtrlD?.();
			if (!customEditor.onPasteImage) customEditor.onPasteImage = () => target.defaultEditor.onPasteImage?.();
			if (!customEditor.onExtensionShortcut) {
				customEditor.onExtensionShortcut = (data: string) => target.defaultEditor.onExtensionShortcut?.(data);
			}
			for (const [action, handler] of target.defaultEditor.actionHandlers) {
				(customEditor.actionHandlers as Map<string, () => void>).set(action, handler);
			}
		}

		target.editor = newEditor;
	} else {
		target.defaultEditor.setText(currentText);
		target.editor = target.defaultEditor;
	}

	target.editorContainer.addChild(target.editor as Component);
	target.ui.setFocus(target.editor as Component);
	target.ui.requestRender();
}

export function showExtensionNotify(
	target: ExtensionUiTarget,
	message: string,
	type?: "info" | "warning" | "error",
): void {
	if (type === "error") target.showError(message);
	else if (type === "warning") target.showWarning(message);
	else target.showStatus(message);
}

export async function showExtensionCustom<T>(
	target: ExtensionUiTarget,
	factory: (
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
		done: (result: T) => void,
	) => DisposableComponent | Promise<DisposableComponent>,
	options?: {
		overlay?: boolean;
		overlayOptions?: OverlayOptions | (() => OverlayOptions);
		onHandle?: (handle: OverlayHandle) => void;
	},
): Promise<T> {
	const savedText = target.editor.getText();
	const isOverlay = options?.overlay ?? false;

	const restoreEditor = () => {
		target.editorContainer.clear();
		target.editorContainer.addChild(target.editor);
		target.editor.setText(savedText);
		target.ui.setFocus(target.editor);
		target.ui.requestRender();
	};

	return new Promise((resolve, reject) => {
		let component: DisposableComponent | undefined;
		let closed = false;

		const close = (result: T) => {
			if (closed) return;
			closed = true;
			if (isOverlay) target.ui.hideOverlay();
			else restoreEditor();
			resolve(result);
			component?.dispose?.();
		};

		Promise.resolve(factory(target.ui, theme, target.keybindings, close))
			.then((createdComponent) => {
				if (closed) return;
				component = createdComponent;
				if (isOverlay) {
					const resolveOptions = (): OverlayOptions | undefined => {
						if (options?.overlayOptions) {
							return typeof options.overlayOptions === "function"
								? options.overlayOptions()
								: options.overlayOptions;
						}
						const width = (createdComponent as { width?: number }).width;
						return width ? { width } : undefined;
					};
					const handle = target.ui.showOverlay(createdComponent, resolveOptions());
					options?.onHandle?.(handle);
				} else {
					target.editorContainer.clear();
					target.editorContainer.addChild(createdComponent);
					target.ui.setFocus(createdComponent);
					target.ui.requestRender();
				}
			})
			.catch((error: unknown) => {
				if (closed) return;
				if (!isOverlay) restoreEditor();
				reject(error);
			});
	});
}

export function showExtensionError(
	target: ExtensionUiTarget,
	extensionPath: string,
	error: string,
	stack?: string,
): void {
	const errorMsg = `Extension "${extensionPath}" error: ${error}`;
	target.chatContainer.addChild(new Text(theme.fg("error", errorMsg), 1, 0));
	if (stack) {
		const stackLines = stack
			.split("\n")
			.slice(1)
			.map((line) => theme.fg("dim", `  ${line.trim()}`))
			.join("\n");
		if (stackLines) target.chatContainer.addChild(new Text(stackLines, 1, 0));
	}
	target.ui.requestRender();
}
