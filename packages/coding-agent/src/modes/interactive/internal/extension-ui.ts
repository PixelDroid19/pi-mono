/**
 * Extension UI overlay helpers extracted from InteractiveMode.
 *
 * Helpers for extension selector, editor replacement, and overlay management.
 * These work through narrow context objects and preserve existing keybinding IDs
 * and emitted events.
 */

import type { Component } from "@mariozechner/pi-tui";

/**
 * Dispose an existing widget and remove it from the map.
 */
export function disposeWidget(map: Map<string, Component & { dispose?(): void }>, key: string): void {
	const existing = map.get(key);
	if (existing?.dispose) existing.dispose();
	map.delete(key);
}

/**
 * Render widgets from a map into a container.
 */
export function renderWidgetContainer(
	container: { clear(): void; addChild(child: Component): void; children: Component[] },
	widgets: Map<string, Component & { dispose?(): void }>,
	options: {
		spacerWhenEmpty: boolean;
		leadingSpacer: boolean;
		createSpacer: (height: number) => Component;
	},
): void {
	container.clear();

	if (widgets.size === 0) {
		if (options.spacerWhenEmpty) {
			container.addChild(options.createSpacer(1));
		}
		return;
	}

	if (options.leadingSpacer) {
		container.addChild(options.createSpacer(1));
	}
	for (const component of widgets.values()) {
		container.addChild(component);
	}
}
