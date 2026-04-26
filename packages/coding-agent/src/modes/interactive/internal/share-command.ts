/**
 * GitHub Gist sharing for exported interactive sessions.
 *
 * The handler owns external `gh` process execution and temporary export file
 * cleanup. InteractiveMode supplies only the editor containers and status/error
 * callbacks needed to preserve the current terminal experience.
 */

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Container, EditorComponent, TUI } from "@mariozechner/pi-tui";
import { getShareViewerUrl } from "../../../config.js";
import type { AgentSession } from "../../../core/agent-session.js";
import { BorderedLoader } from "../components/bordered-loader.js";
import { theme } from "../theme/theme.js";

export interface InteractiveShareCommandTarget {
	editor: EditorComponent;
	editorContainer: Container;
	session: AgentSession;
	ui: TUI;
	showError(message: string): void;
	showStatus(message: string): void;
}

/** Execute the command while preserving InteractiveMode rendering and session side effects. */
export async function handleShareCommand(target: InteractiveShareCommandTarget): Promise<void> {
	// Check if gh is available and logged in
	try {
		const authResult = spawnSync("gh", ["auth", "status"], { encoding: "utf-8" });
		if (authResult.status !== 0) {
			target.showError("GitHub CLI is not logged in. Run 'gh auth login' first.");
			return;
		}
	} catch {
		target.showError("GitHub CLI (gh) is not installed. Install it from https://cli.github.com/");
		return;
	}

	// Export to a temp file
	const tmpFile = path.join(os.tmpdir(), "session.html");
	try {
		await target.session.exportToHtml(tmpFile);
	} catch (error: unknown) {
		target.showError(`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`);
		return;
	}

	// Show cancellable loader, replacing the editor
	const loader = new BorderedLoader(target.ui, theme, "Creating gist...");
	target.editorContainer.clear();
	target.editorContainer.addChild(loader);
	target.ui.setFocus(loader);
	target.ui.requestRender();

	const restoreEditor = () => {
		loader.dispose();
		target.editorContainer.clear();
		target.editorContainer.addChild(target.editor);
		target.ui.setFocus(target.editor);
		try {
			fs.unlinkSync(tmpFile);
		} catch {
			// Ignore cleanup errors
		}
	};

	// Create a secret gist asynchronously
	let proc: ReturnType<typeof spawn> | null = null;

	loader.onAbort = () => {
		proc?.kill();
		restoreEditor();
		target.showStatus("Share cancelled");
	};

	try {
		const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
			proc = spawn("gh", ["gist", "create", "--public=false", tmpFile]);
			let stdout = "";
			let stderr = "";
			proc.stdout?.on("data", (data) => {
				stdout += data.toString();
			});
			proc.stderr?.on("data", (data) => {
				stderr += data.toString();
			});
			proc.on("close", (code) => resolve({ stdout, stderr, code }));
		});

		if (loader.signal.aborted) return;

		restoreEditor();

		if (result.code !== 0) {
			const errorMsg = result.stderr?.trim() || "Unknown error";
			target.showError(`Failed to create gist: ${errorMsg}`);
			return;
		}

		// Extract gist ID from the URL returned by gh
		// gh returns something like: https://gist.github.com/username/GIST_ID
		const gistUrl = result.stdout?.trim();
		const gistId = gistUrl?.split("/").pop();
		if (!gistId) {
			target.showError("Failed to parse gist ID from gh output");
			return;
		}

		// Create the preview URL
		const previewUrl = getShareViewerUrl(gistId);
		target.showStatus(`Share URL: ${previewUrl}\nGist: ${gistUrl}`);
	} catch (error: unknown) {
		if (!loader.signal.aborted) {
			restoreEditor();
			target.showError(`Failed to create gist: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	}
}
