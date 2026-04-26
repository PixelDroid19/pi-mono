/**
 * Initial prompt assembly for non-RPC CLI input.
 *
 * CLI startup can receive prompt text from positional arguments, `@file`
 * arguments, and piped stdin. This module preserves the merge order used by the
 * legacy entrypoint while isolating stdin consumption from mode dispatch.
 */

import type { ImageContent } from "@mariozechner/pi-ai";
import type { Args } from "../args.js";
import { processFileArguments } from "../file-processor.js";
import { buildInitialMessage } from "../initial-message.js";

/**
 * Read piped stdin once and return trimmed content.
 *
 * Interactive terminals are left untouched so the TUI can own stdin after mode
 * selection. Empty pipe content is treated as absent input.
 */
export async function readPipedStdin(): Promise<string | undefined> {
	if (process.stdin.isTTY) {
		return undefined;
	}

	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => {
			resolve(data.trim() || undefined);
		});
		process.stdin.resume();
	});
}

/**
 * Build the initial AgentSession prompt and image attachments.
 *
 * `@file` content is expanded first, then piped stdin and positional messages
 * are merged through the shared CLI initial-message builder. The function does
 * not mutate parsed arguments; callers decide which remaining messages to send.
 */
export async function prepareInitialMessage(
	parsed: Args,
	autoResizeImages: boolean,
	stdinContent?: string,
): Promise<{
	initialMessage?: string;
	initialImages?: ImageContent[];
}> {
	if (parsed.fileArgs.length === 0) {
		return buildInitialMessage({ parsed, stdinContent });
	}

	const { text, images } = await processFileArguments(parsed.fileArgs, { autoResizeImages });
	return buildInitialMessage({
		parsed,
		fileText: text,
		fileImages: images,
		stdinContent,
	});
}
