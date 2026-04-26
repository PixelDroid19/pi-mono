/**
 * Queue orchestration for interactive prompts during streaming and compaction.
 *
 * InteractiveMode owns rendering and editor state. This module owns the ordering
 * contract for queued text: extension commands run as commands, the first
 * non-command prompt starts a turn, and later text is queued as steer/follow-up
 * input. Keeping that policy here makes queue behavior testable without a TUI.
 */

export type QueuedMessageMode = "steer" | "followUp";

export interface CompactionQueuedMessage {
	text: string;
	mode: QueuedMessageMode;
}

export interface QueuedMessages {
	steering: string[];
	followUp: string[];
}

export interface InteractiveQueueSession {
	getSteeringMessages(): readonly string[];
	getFollowUpMessages(): readonly string[];
	clearQueue(): QueuedMessages;
	prompt(text: string): Promise<void>;
	followUp(text: string): Promise<void>;
	steer(text: string): Promise<void>;
}

export interface ExtensionCommandResolver {
	getCommand(name: string): unknown;
}

/**
 * Snapshot user-visible queued messages.
 *
 * The returned order matches the pending-message display: AgentSession queues
 * first, then messages held locally while compaction is in progress. Neither
 * queue is mutated.
 */
export function getAllQueuedMessages(
	session: InteractiveQueueSession,
	compactionQueuedMessages: readonly CompactionQueuedMessage[],
): QueuedMessages {
	return {
		steering: [
			...session.getSteeringMessages(),
			...compactionQueuedMessages.filter((msg) => msg.mode === "steer").map((msg) => msg.text),
		],
		followUp: [
			...session.getFollowUpMessages(),
			...compactionQueuedMessages.filter((msg) => msg.mode === "followUp").map((msg) => msg.text),
		],
	};
}

/**
 * Drain AgentSession queues and merge them with a compaction queue snapshot.
 *
 * AgentSession owns steer/follow-up queues and is cleared here. InteractiveMode
 * owns the compaction queue array, so the caller clears that local state after
 * receiving this merged result.
 */
export function clearAllQueuedMessages(
	session: InteractiveQueueSession,
	compactionQueuedMessages: readonly CompactionQueuedMessage[],
): QueuedMessages {
	const { steering, followUp } = session.clearQueue();
	const compactionSteering = compactionQueuedMessages.filter((msg) => msg.mode === "steer").map((msg) => msg.text);
	const compactionFollowUp = compactionQueuedMessages.filter((msg) => msg.mode === "followUp").map((msg) => msg.text);
	return {
		steering: [...steering, ...compactionSteering],
		followUp: [...followUp, ...compactionFollowUp],
	};
}

/**
 * Check whether a slash-prefixed editor value resolves to an extension command.
 */
export function isExtensionCommandText(text: string, extensionRunner: ExtensionCommandResolver): boolean {
	if (!text.startsWith("/")) return false;

	const spaceIndex = text.indexOf(" ");
	const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
	return !!extensionRunner.getCommand(commandName);
}

export interface FlushCompactionQueueContext {
	session: InteractiveQueueSession;
	extensionRunner: ExtensionCommandResolver;
	getCompactionQueuedMessages(): readonly CompactionQueuedMessage[];
	setCompactionQueuedMessages(messages: CompactionQueuedMessage[]): void;
	updatePendingMessagesDisplay(): void;
	showError(message: string): void;
}

/**
 * Flush messages captured while compaction blocked the active turn.
 *
 * The function preserves the interactive ordering contract and restores the
 * caller-owned compaction queue if any send operation fails. On retry turns,
 * every queued item is sent back into AgentSession queues because the retry
 * prompt is already scheduled by the agent session.
 */
export async function flushCompactionQueuedMessages(
	context: FlushCompactionQueueContext,
	options?: { willRetry?: boolean },
): Promise<void> {
	const queuedMessages = [...context.getCompactionQueuedMessages()];
	if (queuedMessages.length === 0) {
		return;
	}

	context.setCompactionQueuedMessages([]);
	context.updatePendingMessagesDisplay();

	const restoreQueue = (error: unknown) => {
		context.session.clearQueue();
		context.setCompactionQueuedMessages(queuedMessages);
		context.updatePendingMessagesDisplay();
		context.showError(
			`Failed to send queued message${queuedMessages.length > 1 ? "s" : ""}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	};

	try {
		if (options?.willRetry) {
			for (const message of queuedMessages) {
				if (isExtensionCommandText(message.text, context.extensionRunner)) {
					await context.session.prompt(message.text);
				} else if (message.mode === "followUp") {
					await context.session.followUp(message.text);
				} else {
					await context.session.steer(message.text);
				}
			}
			context.updatePendingMessagesDisplay();
			return;
		}

		const firstPromptIndex = queuedMessages.findIndex(
			(message) => !isExtensionCommandText(message.text, context.extensionRunner),
		);
		if (firstPromptIndex === -1) {
			for (const message of queuedMessages) {
				await context.session.prompt(message.text);
			}
			return;
		}

		const preCommands = queuedMessages.slice(0, firstPromptIndex);
		const firstPrompt = queuedMessages[firstPromptIndex];
		const rest = queuedMessages.slice(firstPromptIndex + 1);

		for (const message of preCommands) {
			await context.session.prompt(message.text);
		}

		const promptPromise = context.session.prompt(firstPrompt.text).catch((error) => {
			restoreQueue(error);
		});

		for (const message of rest) {
			if (isExtensionCommandText(message.text, context.extensionRunner)) {
				await context.session.prompt(message.text);
			} else if (message.mode === "followUp") {
				await context.session.followUp(message.text);
			} else {
				await context.session.steer(message.text);
			}
		}
		context.updatePendingMessagesDisplay();
		void promptPromise;
	} catch (error) {
		restoreQueue(error);
	}
}
