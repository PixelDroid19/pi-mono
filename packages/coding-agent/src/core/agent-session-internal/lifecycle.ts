/**
 * AgentSession subscription and lifecycle boundary.
 *
 * Event listener ownership, temporary disconnection, and stale extension
 * invalidation are lifecycle concerns. Keeping them here keeps the facade from
 * carrying low-level listener mutation logic.
 */

import type { Agent, AgentEvent } from "@mariozechner/pi-agent-core";
import type { AgentSessionEvent, AgentSessionEventListener } from "../agent-session-contract.js";
import type { ExtensionRunner } from "../extensions/index.js";

export interface AgentSessionLifecycleTarget {
	agent: Agent;
	_extensionRunner: ExtensionRunner;
	_unsubscribeAgent: (() => void) | undefined;
	_eventListeners: AgentSessionEventListener[];
	_handleAgentEvent(event: AgentEvent): void;
	_disconnectFromAgent(): void;
}

/**
 * Emit a session event to current subscribers.
 */
export function emitSessionEvent(target: AgentSessionLifecycleTarget, event: AgentSessionEvent): void {
	for (const listener of target._eventListeners) {
		listener(event);
	}
}

/**
 * Register a session event listener and return an unsubscribe callback.
 */
export function subscribeToSessionEvents(
	target: AgentSessionLifecycleTarget,
	listener: AgentSessionEventListener,
): () => void {
	target._eventListeners.push(listener);

	return () => {
		const index = target._eventListeners.indexOf(listener);
		if (index !== -1) {
			target._eventListeners.splice(index, 1);
		}
	};
}

/**
 * Stop receiving Agent events without clearing user-facing listeners.
 */
export function disconnectSessionAgent(target: AgentSessionLifecycleTarget): void {
	if (target._unsubscribeAgent) {
		target._unsubscribeAgent();
		target._unsubscribeAgent = undefined;
	}
}

/**
 * Reconnect Agent events after a temporary disconnect.
 */
export function reconnectSessionAgent(target: AgentSessionLifecycleTarget): void {
	if (target._unsubscribeAgent) return;
	target._unsubscribeAgent = target.agent.subscribe(target._handleAgentEvent);
}

/**
 * Invalidate extension contexts and detach all session listeners.
 */
export function disposeSession(target: AgentSessionLifecycleTarget): void {
	target._extensionRunner.invalidate(
		"This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().",
	);
	target._disconnectFromAgent();
	target._eventListeners = [];
}
