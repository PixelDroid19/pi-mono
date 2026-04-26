/**
 * Interactive startup and autocomplete orchestration.
 *
 * The startup path owns first-render layout, required tool discovery, changelog
 * presentation, autocomplete provider assembly, and long-lived UI watchers. It
 * is kept outside `InteractiveMode` so the mode can remain a runtime facade
 * while this module documents the side effects that happen before user input is
 * accepted.
 */

import type {
	AutocompleteItem,
	AutocompleteProvider,
	Component,
	Container,
	EditorComponent,
	SlashCommand,
	TUI,
} from "@mariozechner/pi-tui";
import { CombinedAutocompleteProvider, fuzzyFilter, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { APP_NAME } from "../../../config.js";
import type { AgentSession } from "../../../core/agent-session.js";
import type { AutocompleteProviderFactory } from "../../../core/extensions/index.js";
import type { FooterDataProvider } from "../../../core/footer-data-provider.js";
import type { SessionManager } from "../../../core/session-manager.js";
import type { SettingsManager } from "../../../core/settings-manager.js";
import { BUILTIN_SLASH_COMMANDS } from "../../../core/slash-commands.js";
import type { SourceInfo } from "../../../core/source-info.js";
import { ensureTool } from "../../../utils/tools-manager.js";
import type { CustomEditor } from "../components/custom-editor.js";
import { DynamicBorder as PiDynamicBorder } from "../components/dynamic-border.js";
import { ExpandableText as PiExpandableText } from "../components/expandable-text.js";
import type { FooterComponent } from "../components/footer.js";
import { keyHint, keyText, rawKeyHint } from "../components/keybinding-hints.js";
import { type getMarkdownTheme, onThemeChange, theme } from "../theme/theme.js";

export interface InteractiveStartupTarget {
	autocompleteProvider: AutocompleteProvider | undefined;
	autocompleteProviderWrappers: AutocompleteProviderFactory[];
	builtInHeader: Component | undefined;
	changelogMarkdown: string | undefined;
	chatContainer: Container;
	defaultEditor: CustomEditor;
	editor: EditorComponent;
	editorContainer: Container;
	fdPath: string | undefined;
	footer: FooterComponent;
	footerDataProvider: FooterDataProvider;
	headerContainer: Container;
	isInitialized: boolean;
	options: { verbose?: boolean };
	pendingMessagesContainer: Container;
	session: AgentSession;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	skillCommands: Map<string, string>;
	startupNoticesShown: boolean;
	statusContainer: Container;
	toolOutputExpanded: boolean;
	ui: TUI;
	version: string;
	widgetContainerAbove: Container;
	widgetContainerBelow: Container;
	getChangelogForDisplay(): string | undefined;
	getMarkdownThemeWithSettings(): ReturnType<typeof getMarkdownTheme>;
	prefixAutocompleteDescription(description: string | undefined, sourceInfo?: SourceInfo): string | undefined;
	rebindCurrentSession(): Promise<void>;
	registerSignalHandlers(): void;
	renderInitialMessages(): void;
	renderWidgets(): void;
	setupEditorSubmitHandler(): void;
	setupKeyHandlers(): void;
	updateAvailableProviderCount(): Promise<void>;
	updateEditorBorderColor(): void;
}

/** Build the base slash-command autocomplete provider from built-ins, templates, extensions, and skills. */
export function createBaseAutocompleteProvider(target: InteractiveStartupTarget): AutocompleteProvider {
	const slashCommands: SlashCommand[] = BUILTIN_SLASH_COMMANDS.map((command) => ({
		name: command.name,
		description: command.description,
	}));

	const modelCommand = slashCommands.find((command) => command.name === "model");
	if (modelCommand) {
		modelCommand.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null => {
			const models =
				target.session.scopedModels.length > 0
					? target.session.scopedModels.map((scoped) => scoped.model)
					: target.session.modelRegistry.getAvailable();

			if (models.length === 0) return null;

			const items = models.map((model) => ({
				id: model.id,
				provider: model.provider,
				label: `${model.provider}/${model.id}`,
			}));
			const filtered = fuzzyFilter(items, prefix, (item) => `${item.id} ${item.provider}`);
			if (filtered.length === 0) return null;

			return filtered.map((item) => ({
				value: item.label,
				label: item.id,
				description: item.provider,
			}));
		};
	}

	const templateCommands: SlashCommand[] = target.session.promptTemplates.map((command) => ({
		name: command.name,
		description: target.prefixAutocompleteDescription(command.description, command.sourceInfo),
		...(command.argumentHint && { argumentHint: command.argumentHint }),
	}));

	const builtinCommandNames = new Set(slashCommands.map((command) => command.name));
	const extensionCommands: SlashCommand[] = target.session.extensionRunner
		.getRegisteredCommands()
		.filter((command) => !builtinCommandNames.has(command.name))
		.map((command) => ({
			name: command.invocationName,
			description: target.prefixAutocompleteDescription(command.description, command.sourceInfo),
			getArgumentCompletions: command.getArgumentCompletions,
		}));

	target.skillCommands.clear();
	const skillCommandList: SlashCommand[] = [];
	if (target.settingsManager.getEnableSkillCommands()) {
		for (const skill of target.session.resourceLoader.getSkills().skills) {
			const commandName = `skill:${skill.name}`;
			target.skillCommands.set(commandName, skill.filePath);
			skillCommandList.push({
				name: commandName,
				description: target.prefixAutocompleteDescription(skill.description, skill.sourceInfo),
			});
		}
	}

	return new CombinedAutocompleteProvider(
		[...slashCommands, ...templateCommands, ...extensionCommands, ...skillCommandList],
		target.sessionManager.getCwd(),
		target.fdPath,
	);
}

/** Rebuild autocomplete and attach it to both the default and active editor. */
export function setupAutocompleteProvider(target: InteractiveStartupTarget): void {
	let provider = createBaseAutocompleteProvider(target);
	for (const wrapProvider of target.autocompleteProviderWrappers) {
		provider = wrapProvider(provider);
	}

	target.autocompleteProvider = provider;
	target.defaultEditor.setAutocompleteProvider(provider);
	if (target.editor !== target.defaultEditor) {
		target.editor.setAutocompleteProvider?.(provider);
	}
}

/** Render changelog startup notices once per interactive session. */
export function showStartupNoticesIfNeeded(target: InteractiveStartupTarget): void {
	if (target.startupNoticesShown) {
		return;
	}
	target.startupNoticesShown = true;

	if (!target.changelogMarkdown) {
		return;
	}

	if (target.chatContainer.children.length > 0) {
		target.chatContainer.addChild(new Spacer(1));
	}
	target.chatContainer.addChild(new PiDynamicBorder());
	if (target.settingsManager.getCollapseChangelog()) {
		const versionMatch = target.changelogMarkdown.match(/##\s+\[?(\d+\.\d+\.\d+)\]?/);
		const latestVersion = versionMatch ? versionMatch[1] : target.version;
		const condensedText = `Updated to v${latestVersion}. Use ${theme.bold("/changelog")} to view full changelog.`;
		target.chatContainer.addChild(new Text(condensedText, 1, 0));
	} else {
		target.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
		target.chatContainer.addChild(new Spacer(1));
		target.chatContainer.addChild(
			new Markdown(target.changelogMarkdown.trim(), 1, 0, target.getMarkdownThemeWithSettings()),
		);
		target.chatContainer.addChild(new Spacer(1));
	}
	target.chatContainer.addChild(new PiDynamicBorder());
}

/** Initialize the interactive UI and bind the first runtime session. */
export async function initInteractiveMode(target: InteractiveStartupTarget): Promise<void> {
	if (target.isInitialized) return;

	target.registerSignalHandlers();
	target.changelogMarkdown = target.getChangelogForDisplay();
	const [fdPath] = await Promise.all([ensureTool("fd"), ensureTool("rg")]);
	target.fdPath = fdPath;

	target.ui.addChild(target.headerContainer);
	if (target.options.verbose || !target.settingsManager.getQuietStartup()) {
		const logo = theme.bold(theme.fg("accent", APP_NAME)) + theme.fg("dim", ` v${target.version}`);
		const hint = (keybinding: Parameters<typeof keyHint>[0], description: string) => keyHint(keybinding, description);
		const expandedInstructions = [
			hint("app.interrupt", "to interrupt"),
			hint("app.clear", "to clear"),
			rawKeyHint(`${keyText("app.clear")} twice`, "to exit"),
			hint("app.exit", "to exit (empty)"),
			hint("app.suspend", "to suspend"),
			keyHint("tui.editor.deleteToLineEnd", "to delete to end"),
			hint("app.thinking.cycle", "to cycle thinking level"),
			rawKeyHint(`${keyText("app.model.cycleForward")}/${keyText("app.model.cycleBackward")}`, "to cycle models"),
			hint("app.model.select", "to select model"),
			hint("app.tools.expand", "to expand tools"),
			hint("app.thinking.toggle", "to expand thinking"),
			hint("app.editor.external", "for external editor"),
			rawKeyHint("/", "for commands"),
			rawKeyHint("!", "to run bash"),
			rawKeyHint("!!", "to run bash (no context)"),
			hint("app.message.followUp", "to queue follow-up"),
			hint("app.message.dequeue", "to edit all queued messages"),
			hint("app.clipboard.pasteImage", "to paste image"),
			rawKeyHint("drop files", "to attach"),
		].join("\n");
		const compactInstructions = [
			hint("app.interrupt", "interrupt"),
			rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
			rawKeyHint("/", "commands"),
			rawKeyHint("!", "bash"),
			hint("app.tools.expand", "more"),
		].join(theme.fg("muted", " · "));
		const compactOnboarding = theme.fg(
			"dim",
			`Press ${keyText("app.tools.expand")} to show full startup help and loaded resources.`,
		);
		const onboarding = theme.fg(
			"dim",
			"Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.",
		);
		target.builtInHeader = new PiExpandableText(
			() => `${logo}\n${compactInstructions}\n${compactOnboarding}\n\n${onboarding}`,
			() => `${logo}\n${expandedInstructions}\n\n${onboarding}`,
			target.options.verbose === true || target.toolOutputExpanded,
			1,
			0,
		);
		target.headerContainer.addChild(new Spacer(1));
		target.headerContainer.addChild(target.builtInHeader);
		target.headerContainer.addChild(new Spacer(1));
	} else {
		target.builtInHeader = new Text("", 0, 0);
		target.headerContainer.addChild(target.builtInHeader);
	}

	target.ui.addChild(target.chatContainer);
	target.ui.addChild(target.pendingMessagesContainer);
	target.ui.addChild(target.statusContainer);
	target.renderWidgets();
	target.ui.addChild(target.widgetContainerAbove);
	target.ui.addChild(target.editorContainer);
	target.ui.addChild(target.widgetContainerBelow);
	target.ui.addChild(target.footer);
	target.ui.setFocus(target.editor);

	target.setupKeyHandlers();
	target.setupEditorSubmitHandler();
	target.ui.start();
	target.isInitialized = true;

	await target.rebindCurrentSession();
	target.renderInitialMessages();

	onThemeChange(() => {
		target.ui.invalidate();
		target.updateEditorBorderColor();
		target.ui.requestRender();
	});

	target.footerDataProvider.onBranchChange(() => {
		target.ui.requestRender();
	});

	await target.updateAvailableProviderCount();
}
