/**
 * Bash command execution for InteractiveMode.
 *
 * This module coordinates extension interception, deferred rendering while the
 * agent is streaming, shell execution, and session recording for commands
 * submitted with `!` or `!!`.
 */

import type { Container, TUI } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { SessionManager } from "../../../core/session-manager.js";
import type { TruncationResult } from "../../../core/tools/truncate.js";
import { BashExecutionComponent } from "../components/bash-execution.js";

export interface InteractiveBashCommandTarget {
	bashComponent: BashExecutionComponent | undefined;
	chatContainer: Container;
	pendingBashComponents: BashExecutionComponent[];
	pendingMessagesContainer: Container;
	session: AgentSession;
	sessionManager: SessionManager;
	ui: TUI;
	showError(message: string): void;
}

/** Execute the command while preserving InteractiveMode rendering and session side effects. */
export async function handleBashCommand(
	target: InteractiveBashCommandTarget,
	command: string,
	excludeFromContext = false,
): Promise<void> {
	const extensionRunner = target.session.extensionRunner;

	// Emit user_bash event to let extensions intercept
	const eventResult = await extensionRunner.emitUserBash({
		type: "user_bash",
		command,
		excludeFromContext,
		cwd: target.sessionManager.getCwd(),
	});

	// If extension returned a full result, use it directly
	if (eventResult?.result) {
		const result = eventResult.result;

		// Create UI component for display
		target.bashComponent = new BashExecutionComponent(command, target.ui, excludeFromContext);
		if (target.session.isStreaming) {
			target.pendingMessagesContainer.addChild(target.bashComponent);
			target.pendingBashComponents.push(target.bashComponent);
		} else {
			target.chatContainer.addChild(target.bashComponent);
		}

		// Show output and complete
		if (result.output) {
			target.bashComponent.appendOutput(result.output);
		}
		target.bashComponent.setComplete(
			result.exitCode,
			result.cancelled,
			result.truncated ? ({ truncated: true, content: result.output } as TruncationResult) : undefined,
			result.fullOutputPath,
		);

		// Record the result in session
		target.session.recordBashResult(command, result, { excludeFromContext });
		target.bashComponent = undefined;
		target.ui.requestRender();
		return;
	}

	// Normal execution path (possibly with custom operations)
	const isDeferred = target.session.isStreaming;
	target.bashComponent = new BashExecutionComponent(command, target.ui, excludeFromContext);

	if (isDeferred) {
		// Show in pending area when agent is streaming
		target.pendingMessagesContainer.addChild(target.bashComponent);
		target.pendingBashComponents.push(target.bashComponent);
	} else {
		// Show in chat immediately when agent is idle
		target.chatContainer.addChild(target.bashComponent);
	}
	target.ui.requestRender();

	try {
		const result = await target.session.executeBash(
			command,
			(chunk) => {
				if (target.bashComponent) {
					target.bashComponent.appendOutput(chunk);
					target.ui.requestRender();
				}
			},
			{ excludeFromContext, operations: eventResult?.operations },
		);

		if (target.bashComponent) {
			target.bashComponent.setComplete(
				result.exitCode,
				result.cancelled,
				result.truncated ? ({ truncated: true, content: result.output } as TruncationResult) : undefined,
				result.fullOutputPath,
			);
		}
	} catch (error) {
		if (target.bashComponent) {
			target.bashComponent.setComplete(undefined, false);
		}
		target.showError(`Bash command failed: ${error instanceof Error ? error.message : "Unknown error"}`);
	}

	target.bashComponent = undefined;
	target.ui.requestRender();
}
