/**
 * Prompt intake boundary for AgentSession.
 *
 * This module owns the decision made before a user string reaches the agent:
 * extension command execution, skill/template expansion, model/auth guardrails,
 * and whether input should start a turn or enter the steer/follow-up queues.
 * AgentSession delegates here so public API signatures remain unchanged.
 */

import type { Agent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ImageContent, Model, TextContent } from "@mariozechner/pi-ai";
import type { PromptOptions } from "../agent-session.js";
import { formatNoApiKeyFoundMessage, formatNoModelSelectedMessage } from "../auth-guidance.js";
import type { ExtensionRunner } from "../extensions/index.js";
import type { CustomMessage } from "../messages.js";
import type { ModelRegistry } from "../model-registry.js";
import { expandPromptTemplate, type PromptTemplate } from "../prompt-templates.js";
import type { ResourceLoader } from "../resource-loader.js";
import type { BuildSystemPromptOptions } from "../system-prompt.js";
import { expandSkillCommand, parseExtensionCommand } from "./prompt-expansion.js";

/**
 * Internal AgentSession state required to process prompt intake.
 *
 * Queue helpers mutate private arrays and emit queue events. Keep this target
 * narrow so future prompt behavior changes document exactly which session state
 * is allowed to change.
 */
export interface AgentSessionPromptTarget {
	agent: Agent;
	_extensionRunner: ExtensionRunner;
	_resourceLoader: ResourceLoader;
	_modelRegistry: ModelRegistry;
	_baseSystemPrompt: string;
	_baseSystemPromptOptions: BuildSystemPromptOptions;
	_pendingNextTurnMessages: CustomMessage[];
	_steeringMessages: string[];
	_followUpMessages: string[];
	model: Model<any> | undefined;
	isStreaming: boolean;
	promptTemplates: ReadonlyArray<PromptTemplate>;
	_emitQueueUpdate(): void;
	_tryExecuteExtensionCommand(text: string): Promise<boolean>;
	_expandSkillCommand(text: string): string;
	_queueSteer(text: string, images?: ImageContent[]): Promise<void>;
	_queueFollowUp(text: string, images?: ImageContent[]): Promise<void>;
	_throwIfExtensionCommand(text: string): void;
	_flushPendingBashMessages(): void;
	_findLastAssistantMessage(): AssistantMessage | undefined;
	_checkCompaction(message: AssistantMessage, skipAbortedCheck?: boolean): Promise<void>;
	_waitForAgentEvents(): Promise<void>;
	waitForRetry(): Promise<void>;
}

/**
 * Execute the full prompt pipeline, including input interception, template
 * expansion, queueing, auth checks, and before-agent-start extension hooks.
 */
export async function promptSession(
	target: AgentSessionPromptTarget,
	text: string,
	options?: PromptOptions,
): Promise<void> {
	const expandPromptTemplates = options?.expandPromptTemplates ?? true;
	const preflightResult = options?.preflightResult;
	let messages: AgentMessage[] | undefined;

	try {
		if (expandPromptTemplates && text.startsWith("/")) {
			const handled = await target._tryExecuteExtensionCommand(text);
			if (handled) {
				preflightResult?.(true);
				return;
			}
		}

		let currentText = text;
		let currentImages = options?.images;

		if (target._extensionRunner.hasHandlers("input")) {
			const inputResult = await target._extensionRunner.emitInput(
				currentText,
				currentImages,
				options?.source ?? "interactive",
			);
			if (inputResult.action === "handled") {
				preflightResult?.(true);
				return;
			}
			if (inputResult.action === "transform") {
				currentText = inputResult.text;
				currentImages = inputResult.images ?? currentImages;
			}
		}

		let expandedText = currentText;
		if (expandPromptTemplates) {
			expandedText = target._expandSkillCommand(expandedText);
			expandedText = expandPromptTemplate(expandedText, [...target.promptTemplates]);
		}

		if (target.isStreaming) {
			if (!options?.streamingBehavior) {
				throw new Error(
					"Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
				);
			}

			if (options.streamingBehavior === "followUp") {
				await target._queueFollowUp(expandedText, currentImages);
			} else {
				await target._queueSteer(expandedText, currentImages);
			}

			preflightResult?.(true);
			return;
		}

		target._flushPendingBashMessages();

		if (!target.model) {
			throw new Error(formatNoModelSelectedMessage());
		}

		if (!target._modelRegistry.hasConfiguredAuth(target.model)) {
			if (target._modelRegistry.isUsingOAuth(target.model)) {
				throw new Error(
					`Authentication failed for "${target.model.provider}". ` +
						`Credentials may have expired or network is unavailable. ` +
						`Run '/login ${target.model.provider}' to re-authenticate.`,
				);
			}

			throw new Error(formatNoApiKeyFoundMessage(target.model.provider));
		}

		const lastAssistant = target._findLastAssistantMessage();
		if (lastAssistant) {
			await target._checkCompaction(lastAssistant, false);
		}

		const userContent: Array<TextContent | ImageContent> = [{ type: "text", text: expandedText }];
		if (currentImages) {
			userContent.push(...currentImages);
		}

		messages = [
			{
				role: "user",
				content: userContent,
				timestamp: Date.now(),
			},
		];

		messages.push(...target._pendingNextTurnMessages.splice(0));

		const result = await target._extensionRunner.emitBeforeAgentStart(
			expandedText,
			currentImages,
			target._baseSystemPrompt,
			target._baseSystemPromptOptions,
		);

		if (result?.messages) {
			for (const message of result.messages) {
				messages.push({
					role: "custom",
					customType: message.customType,
					content: message.content,
					display: message.display,
					details: message.details,
					timestamp: Date.now(),
				});
			}
		}

		target.agent.state.systemPrompt = result?.systemPrompt ?? target._baseSystemPrompt;
	} catch (error) {
		preflightResult?.(false);
		throw error;
	}

	if (!messages) {
		return;
	}

	preflightResult?.(true);
	await target.agent.prompt(messages);
	await target._waitForAgentEvents();
	await target.waitForRetry();
	await target._waitForAgentEvents();
}

/**
 * Execute a registered extension slash command.
 *
 * Returns `true` when a command exists, even if its handler throws, because the
 * command itself was still claimed.
 */
export async function tryExecuteExtensionCommand(
	target: Pick<AgentSessionPromptTarget, "_extensionRunner">,
	text: string,
): Promise<boolean> {
	const command = parseExtensionCommand(text);
	if (!command) {
		return false;
	}

	const registeredCommand = target._extensionRunner.getCommand(command.commandName);
	if (!registeredCommand) {
		return false;
	}

	const ctx = target._extensionRunner.createCommandContext();

	try {
		await registeredCommand.handler(command.args, ctx);
		return true;
	} catch (error) {
		target._extensionRunner.emitError({
			extensionPath: `command:${command.commandName}`,
			event: "command",
			error: error instanceof Error ? error.message : String(error),
		});
		return true;
	}
}

/**
 * Expand a `/skill:` invocation using the current resource loader.
 */
export function expandSessionSkillCommand(
	target: Pick<AgentSessionPromptTarget, "_extensionRunner" | "_resourceLoader">,
	text: string,
): string {
	return expandSkillCommand(text, target._resourceLoader, target._extensionRunner);
}

/**
 * Queue a steering message after validating and expanding it.
 */
export async function steerSession(
	target: Pick<
		AgentSessionPromptTarget,
		"_expandSkillCommand" | "_queueSteer" | "_throwIfExtensionCommand" | "promptTemplates"
	>,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	if (text.startsWith("/")) {
		target._throwIfExtensionCommand(text);
	}

	let expandedText = target._expandSkillCommand(text);
	expandedText = expandPromptTemplate(expandedText, [...target.promptTemplates]);
	await target._queueSteer(expandedText, images);
}

/**
 * Queue a follow-up message after validating and expanding it.
 */
export async function followUpSession(
	target: Pick<
		AgentSessionPromptTarget,
		"_expandSkillCommand" | "_queueFollowUp" | "_throwIfExtensionCommand" | "promptTemplates"
	>,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	if (text.startsWith("/")) {
		target._throwIfExtensionCommand(text);
	}

	let expandedText = target._expandSkillCommand(text);
	expandedText = expandPromptTemplate(expandedText, [...target.promptTemplates]);
	await target._queueFollowUp(expandedText, images);
}

/**
 * Queue a steering message that has already been expanded and validated.
 */
export async function queueSteeringMessage(
	target: Pick<AgentSessionPromptTarget, "agent" | "_emitQueueUpdate" | "_steeringMessages">,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	target._steeringMessages.push(text);
	target._emitQueueUpdate();

	const content: Array<TextContent | ImageContent> = [{ type: "text", text }];
	if (images) {
		content.push(...images);
	}

	target.agent.steer({
		role: "user",
		content,
		timestamp: Date.now(),
	});
}

/**
 * Queue a follow-up message that has already been expanded and validated.
 */
export async function queueFollowUpMessage(
	target: Pick<AgentSessionPromptTarget, "agent" | "_emitQueueUpdate" | "_followUpMessages">,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	target._followUpMessages.push(text);
	target._emitQueueUpdate();

	const content: Array<TextContent | ImageContent> = [{ type: "text", text }];
	if (images) {
		content.push(...images);
	}

	target.agent.followUp({
		role: "user",
		content,
		timestamp: Date.now(),
	});
}

/**
 * Reject queueing when the input refers to an extension slash command.
 */
export function throwIfExtensionCommand(
	target: Pick<AgentSessionPromptTarget, "_extensionRunner">,
	text: string,
): void {
	const command = parseExtensionCommand(text);
	if (!command) {
		return;
	}

	if (target._extensionRunner.getCommand(command.commandName)) {
		throw new Error(
			`Extension command "/${command.commandName}" cannot be queued. Use prompt() or execute the command when not streaming.`,
		);
	}
}
