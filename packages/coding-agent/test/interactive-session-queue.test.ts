import { describe, expect, it } from "vitest";
import {
	type CompactionQueuedMessage,
	clearAllQueuedMessages,
	flushCompactionQueuedMessages,
	getAllQueuedMessages,
	type InteractiveQueueSession,
	isExtensionCommandText,
} from "../src/modes/interactive/internal/session-queue.js";

function createQueueSession(options?: {
	steering?: string[];
	followUp?: string[];
	log?: string[];
	rejectOn?: string;
}): InteractiveQueueSession {
	const steering = options?.steering ?? [];
	const followUp = options?.followUp ?? [];
	const log = options?.log;

	const record = async (entry: string) => {
		log?.push(entry);
		if (options?.rejectOn === entry) {
			throw new Error("queue failure");
		}
	};

	return {
		getSteeringMessages: () => steering,
		getFollowUpMessages: () => followUp,
		clearQueue: () => {
			log?.push("clearQueue");
			return { steering, followUp };
		},
		prompt: (text) => record(`prompt:${text}`),
		followUp: (text) => record(`followUp:${text}`),
		steer: (text) => record(`steer:${text}`),
	};
}

function createCommandResolver(commandNames: readonly string[]) {
	return {
		getCommand: (name: string) => (commandNames.includes(name) ? { name } : undefined),
	};
}

describe("interactive session queue helpers", () => {
	it("reads session and compaction queues without mutating them", () => {
		const session = createQueueSession({ steering: ["session steer"], followUp: ["session follow"] });
		const compactionQueue: CompactionQueuedMessage[] = [
			{ text: "compact steer", mode: "steer" },
			{ text: "compact follow", mode: "followUp" },
		];

		expect(getAllQueuedMessages(session, compactionQueue)).toEqual({
			steering: ["session steer", "compact steer"],
			followUp: ["session follow", "compact follow"],
		});
	});

	it("clears session queues while returning a compaction queue snapshot", () => {
		const log: string[] = [];
		const session = createQueueSession({ steering: ["session steer"], followUp: ["session follow"], log });
		const compactionQueue: CompactionQueuedMessage[] = [
			{ text: "compact steer", mode: "steer" },
			{ text: "compact follow", mode: "followUp" },
		];

		expect(clearAllQueuedMessages(session, compactionQueue)).toEqual({
			steering: ["session steer", "compact steer"],
			followUp: ["session follow", "compact follow"],
		});
		expect(log).toEqual(["clearQueue"]);
	});

	it("detects extension commands by slash-command name", () => {
		const resolver = createCommandResolver(["deploy"]);

		expect(isExtensionCommandText("/deploy prod", resolver)).toBe(true);
		expect(isExtensionCommandText("/missing prod", resolver)).toBe(false);
		expect(isExtensionCommandText("deploy prod", resolver)).toBe(false);
	});

	it("flushes commands before the first prompt and queues remaining text by mode", async () => {
		const log: string[] = [];
		let compactionQueue: CompactionQueuedMessage[] = [
			{ text: "/deploy prod", mode: "steer" },
			{ text: "ship it", mode: "steer" },
			{ text: "afterward", mode: "followUp" },
			{ text: "nudge", mode: "steer" },
		];
		let updateCount = 0;
		let errorMessage: string | undefined;

		await flushCompactionQueuedMessages({
			session: createQueueSession({ log }),
			extensionRunner: createCommandResolver(["deploy"]),
			getCompactionQueuedMessages: () => compactionQueue,
			setCompactionQueuedMessages: (messages) => {
				compactionQueue = messages;
			},
			updatePendingMessagesDisplay: () => {
				updateCount += 1;
			},
			showError: (message) => {
				errorMessage = message;
			},
		});

		expect(compactionQueue).toEqual([]);
		expect(updateCount).toBe(2);
		expect(errorMessage).toBeUndefined();
		expect(log).toEqual(["prompt:/deploy prod", "prompt:ship it", "followUp:afterward", "steer:nudge"]);
	});

	it("restores the compaction queue when a queued message fails", async () => {
		const log: string[] = [];
		const originalQueue: CompactionQueuedMessage[] = [
			{ text: "ship it", mode: "steer" },
			{ text: "afterward", mode: "followUp" },
		];
		let compactionQueue = [...originalQueue];
		let errorMessage: string | undefined;

		await flushCompactionQueuedMessages({
			session: createQueueSession({ log, rejectOn: "followUp:afterward" }),
			extensionRunner: createCommandResolver([]),
			getCompactionQueuedMessages: () => compactionQueue,
			setCompactionQueuedMessages: (messages) => {
				compactionQueue = messages;
			},
			updatePendingMessagesDisplay: () => {},
			showError: (message) => {
				errorMessage = message;
			},
		});

		expect(compactionQueue).toEqual(originalQueue);
		expect(errorMessage).toContain("Failed to send queued messages: queue failure");
		expect(log).toEqual(["prompt:ship it", "followUp:afterward", "clearQueue"]);
	});
});
