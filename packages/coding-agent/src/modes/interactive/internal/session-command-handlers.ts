/**
 * Session and display command handlers for InteractiveMode.
 *
 * These handlers implement slash commands that read or mutate session state,
 * write local debug/export artifacts, or render informational blocks. The
 * command host keeps runtime ownership in InteractiveMode while moving command
 * policy and presentation out of the main class.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Container, Loader, MarkdownTheme, TUI } from "@mariozechner/pi-tui";
import { Markdown, Spacer, Text, visibleWidth } from "@mariozechner/pi-tui";
import { getDebugLogPath } from "../../../config.js";
import type { AgentSession } from "../../../core/agent-session.js";
import type { AgentSessionRuntime } from "../../../core/agent-session-runtime.js";
import { SessionImportFileNotFoundError } from "../../../core/agent-session-runtime.js";
import { MissingSessionCwdError } from "../../../core/session-cwd.js";
import type { SessionManager } from "../../../core/session-manager.js";
import { getChangelogPath, parseChangelog } from "../../../utils/changelog.js";
import { copyToClipboard } from "../../../utils/clipboard.js";
import { DynamicBorder } from "../components/dynamic-border.js";
import { theme } from "../theme/theme.js";
import { parsePathCommandArgument } from "./commands.js";
import { formatSessionInfo } from "./session-info.js";

export interface SessionCommandTarget {
	chatContainer: Container;
	loadingAnimation: Loader | undefined;
	runtimeHost: AgentSessionRuntime;
	session: AgentSession;
	sessionManager: SessionManager;
	statusContainer: Container;
	ui: TUI;
	getMarkdownThemeWithSettings(): MarkdownTheme;
	handleFatalRuntimeError(prefix: string, error: unknown): Promise<never>;
	promptForMissingSessionCwd(error: MissingSessionCwdError): Promise<string | undefined>;
	renderCurrentSessionState(): void;
	showError(message: string): void;
	showExtensionConfirm(title: string, message: string): Promise<boolean>;
	showStatus(message: string): void;
	showWarning(message: string): void;
}

/** Execute the InteractiveMode export command. */
export async function handleExportCommand(target: SessionCommandTarget, text: string): Promise<void> {
	const outputPath = parsePathCommandArgument(text, "/export");

	try {
		if (outputPath?.endsWith(".jsonl")) {
			const filePath = target.session.exportToJsonl(outputPath);
			target.showStatus(`Session exported to: ${filePath}`);
		} else {
			const filePath = await target.session.exportToHtml(outputPath);
			target.showStatus(`Session exported to: ${filePath}`);
		}
	} catch (error: unknown) {
		target.showError(`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`);
	}
}

/** Execute the InteractiveMode import command. */
export async function handleImportCommand(target: SessionCommandTarget, text: string): Promise<void> {
	const inputPath = parsePathCommandArgument(text, "/import");
	if (!inputPath) {
		target.showError("Usage: /import <path.jsonl>");
		return;
	}

	const confirmed = await target.showExtensionConfirm("Import session", `Replace current session with ${inputPath}?`);
	if (!confirmed) {
		target.showStatus("Import cancelled");
		return;
	}

	try {
		if (target.loadingAnimation) {
			target.loadingAnimation.stop();
			target.loadingAnimation = undefined;
		}
		target.statusContainer.clear();
		const result = await target.runtimeHost.importFromJsonl(inputPath);
		if (result.cancelled) {
			target.showStatus("Import cancelled");
			return;
		}
		target.renderCurrentSessionState();
		target.showStatus(`Session imported from: ${inputPath}`);
	} catch (error: unknown) {
		if (error instanceof MissingSessionCwdError) {
			const selectedCwd = await target.promptForMissingSessionCwd(error);
			if (!selectedCwd) {
				target.showStatus("Import cancelled");
				return;
			}
			const result = await target.runtimeHost.importFromJsonl(inputPath, selectedCwd);
			if (result.cancelled) {
				target.showStatus("Import cancelled");
				return;
			}
			target.renderCurrentSessionState();
			target.showStatus(`Session imported from: ${inputPath}`);
			return;
		}
		if (error instanceof SessionImportFileNotFoundError) {
			target.showError(`Failed to import session: ${error.message}`);
			return;
		}
		await target.handleFatalRuntimeError("Failed to import session", error);
	}
}

/** Execute the InteractiveMode copy command. */
export async function handleCopyCommand(target: SessionCommandTarget): Promise<void> {
	const text = target.session.getLastAssistantText();
	if (!text) {
		target.showError("No agent messages to copy yet.");
		return;
	}

	try {
		await copyToClipboard(text);
		target.showStatus("Copied last agent message to clipboard");
	} catch (error) {
		target.showError(error instanceof Error ? error.message : String(error));
	}
}

/** Execute the InteractiveMode name command. */
export function handleNameCommand(target: SessionCommandTarget, text: string): void {
	const name = text.replace(/^\/name\s*/, "").trim();
	if (!name) {
		const currentName = target.sessionManager.getSessionName();
		if (currentName) {
			target.chatContainer.addChild(new Spacer(1));
			target.chatContainer.addChild(new Text(theme.fg("dim", `Session name: ${currentName}`), 1, 0));
		} else {
			target.showWarning("Usage: /name <name>");
		}
		target.ui.requestRender();
		return;
	}

	target.session.setSessionName(name);
	target.chatContainer.addChild(new Spacer(1));
	target.chatContainer.addChild(new Text(theme.fg("dim", `Session name set: ${name}`), 1, 0));
	target.ui.requestRender();
}

/** Execute the InteractiveMode session command. */
export function handleSessionCommand(target: SessionCommandTarget): void {
	const stats = target.session.getSessionStats();
	const sessionName = target.sessionManager.getSessionName();
	const info = formatSessionInfo(stats, sessionName, {
		bold: (text) => theme.bold(text),
		dim: (text) => theme.fg("dim", text),
	});

	target.chatContainer.addChild(new Spacer(1));
	target.chatContainer.addChild(new Text(info, 1, 0));
	target.ui.requestRender();
}

/** Execute the InteractiveMode changelog command. */
export function handleChangelogCommand(target: SessionCommandTarget): void {
	const changelogPath = getChangelogPath();
	const allEntries = parseChangelog(changelogPath);

	const changelogMarkdown =
		allEntries.length > 0
			? allEntries
					.reverse()
					.map((e) => e.content)
					.join("\n\n")
			: "No changelog entries found.";

	target.chatContainer.addChild(new Spacer(1));
	target.chatContainer.addChild(new DynamicBorder());
	target.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
	target.chatContainer.addChild(new Spacer(1));
	target.chatContainer.addChild(new Markdown(changelogMarkdown, 1, 1, target.getMarkdownThemeWithSettings()));
	target.chatContainer.addChild(new DynamicBorder());
	target.ui.requestRender();
}

/** Execute the InteractiveMode clear command. */
export async function handleClearCommand(target: SessionCommandTarget): Promise<void> {
	if (target.loadingAnimation) {
		target.loadingAnimation.stop();
		target.loadingAnimation = undefined;
	}
	target.statusContainer.clear();
	try {
		const result = await target.runtimeHost.newSession();
		if (result.cancelled) {
			return;
		}
		target.renderCurrentSessionState();
		target.chatContainer.addChild(new Spacer(1));
		target.chatContainer.addChild(new Text(`${theme.fg("accent", "✓ New session started")}`, 1, 1));
		target.ui.requestRender();
	} catch (error: unknown) {
		await target.handleFatalRuntimeError("Failed to create session", error);
	}
}

/** Execute the InteractiveMode debug command. */
export function handleDebugCommand(target: SessionCommandTarget): void {
	const width = target.ui.terminal.columns;
	const height = target.ui.terminal.rows;
	const allLines = target.ui.render(width);

	const debugLogPath = getDebugLogPath();
	const debugData = [
		`Debug output at ${new Date().toISOString()}`,
		`Terminal: ${width}x${height}`,
		`Total lines: ${allLines.length}`,
		"",
		"=== All rendered lines with visible widths ===",
		...allLines.map((line, idx) => {
			const vw = visibleWidth(line);
			const escaped = JSON.stringify(line);
			return `[${idx}] (w=${vw}) ${escaped}`;
		}),
		"",
		"=== Agent messages (JSONL) ===",
		...target.session.messages.map((msg) => JSON.stringify(msg)),
		"",
	].join("\n");

	fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
	fs.writeFileSync(debugLogPath, debugData);

	target.chatContainer.addChild(new Spacer(1));
	target.chatContainer.addChild(
		new Text(`${theme.fg("accent", "✓ Debug log written")}\n${theme.fg("muted", debugLogPath)}`, 1, 1),
	);
	target.ui.requestRender();
}

/** Execute the InteractiveMode compact command. */
export async function handleCompactCommand(target: SessionCommandTarget, customInstructions?: string): Promise<void> {
	const entries = target.sessionManager.getEntries();
	const messageCount = entries.filter((e) => e.type === "message").length;

	if (messageCount < 2) {
		target.showWarning("Nothing to compact (no messages yet)");
		return;
	}

	if (target.loadingAnimation) {
		target.loadingAnimation.stop();
		target.loadingAnimation = undefined;
	}
	target.statusContainer.clear();

	try {
		await target.session.compact(customInstructions);
	} catch {
		// Ignore, will be emitted as an event
	}
}
