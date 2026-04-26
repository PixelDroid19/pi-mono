import { describe, expect, it } from "vitest";
import { clampThinkingLevel } from "../src/core/agent-session-internal/model-state.js";
import { buildExtensionResourcePaths, getExtensionSourceLabel } from "../src/core/agent-session-internal/reload.js";
import {
	findLastAssistantInMessages,
	getUserMessageText,
	isRetryableAssistantError,
} from "../src/core/agent-session-internal/session-events.js";

describe("agent-session internals", () => {
	it("extracts user text from structured content", () => {
		expect(
			getUserMessageText({
				role: "user",
				content: [
					{ type: "text", text: "hello" },
					{ type: "image", mimeType: "image/png", data: "ZmFrZQ==" },
					{ type: "text", text: "world" },
				],
				timestamp: Date.now(),
			}),
		).toBe("helloworld");
	});

	it("finds the last assistant message in a mixed message list", () => {
		const assistant = {
			role: "assistant" as const,
			content: [{ type: "text" as const, text: "done" }],
			stopReason: "stop" as const,
			timestamp: Date.now(),
		};

		expect(
			findLastAssistantInMessages([
				{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() },
				assistant,
			] as never),
		).toBe(assistant);
	});

	it("classifies retryable assistant errors", () => {
		expect(
			isRetryableAssistantError(
				{
					role: "assistant",
					content: [{ type: "text", text: "" }],
					stopReason: "error",
					errorMessage: "Provider finish_reason: network_error",
					timestamp: Date.now(),
				} as never,
				0,
			),
		).toBe(true);

		expect(
			isRetryableAssistantError(
				{
					role: "assistant",
					content: [{ type: "text", text: "" }],
					stopReason: "error",
					errorMessage: "validation failed",
					timestamp: Date.now(),
				} as never,
				0,
			),
		).toBe(false);
	});

	it("clamps unsupported thinking levels to the nearest available level", () => {
		expect(clampThinkingLevel("high", ["off", "minimal", "low"])).toBe("low");
	});

	it("derives extension resource labels and metadata", () => {
		expect(getExtensionSourceLabel("<runtime>")).toBe("extension:runtime");
		expect(getExtensionSourceLabel("/tmp/example-extension.ts")).toBe("extension:example-extension");
		expect(
			buildExtensionResourcePaths([{ path: "/tmp/skills", extensionPath: "/tmp/example-extension.ts" }]),
		).toEqual([
			{
				path: "/tmp/skills",
				metadata: {
					source: "extension:example-extension",
					scope: "temporary",
					origin: "top-level",
					baseDir: "/tmp",
				},
			},
		]);
	});
});
