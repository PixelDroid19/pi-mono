import type { AgentMessage } from "../types.js";

/** Controls whether pending messages are drained one by one or in batches. */
export type QueueMode = "all" | "one-at-a-time";

/**
 * Runtime queue used for steering and follow-up messages.
 *
 * The queue owns insertion order. Draining in `"all"` mode preserves the
 * entire pending batch, while `"one-at-a-time"` keeps the remaining messages
 * queued for later turns.
 */
export class PendingMessageQueue {
	private messages: AgentMessage[] = [];

	constructor(public mode: QueueMode) {}

	enqueue(message: AgentMessage): void {
		this.messages.push(message);
	}

	hasItems(): boolean {
		return this.messages.length > 0;
	}

	drain(): AgentMessage[] {
		if (this.mode === "all") {
			const drained = this.messages.slice();
			this.messages = [];
			return drained;
		}

		const first = this.messages[0];
		if (!first) {
			return [];
		}
		this.messages = this.messages.slice(1);
		return [first];
	}

	clear(): void {
		this.messages = [];
	}
}
