#!/usr/bin/env node

import process from "node:process";

const protectedMatchers = [
	{
		label: "packages/ai/src/models.generated.ts",
		test: (value) => /(^|\/)packages\/ai\/src\/models\.generated\.ts($|\b)/i.test(normalize(value)),
	},
	{
		label: "packages/*/CHANGELOG.md",
		test: (value) => /(^|\/)packages\/[^/]+\/CHANGELOG\.md($|\b)/i.test(normalize(value)),
	},
];

const mutatingToolPatterns = [
	/apply_patch/i,
	/create_file/i,
	/delete/i,
	/edit/i,
	/insert/i,
	/rename/i,
	/str_replace/i,
	/write/i,
	/vscode_renameSymbol/i,
];

const explicitOverridePatterns = [
	/\[allow-protected-edit\]/i,
	/\b(regenerate|update|edit)\b[\s\S]{0,120}models\.generated\.ts/i,
	/models\.generated\.ts[\s\S]{0,120}\b(regenerate|update|edit)\b/i,
	/\b(update|edit)\b[\s\S]{0,120}CHANGELOG/i,
	/CHANGELOG[\s\S]{0,120}\b(update|edit)\b/i,
	/\brelease work\b/i,
	/\bmaintainer release\b/i,
];

function normalize(value) {
	return String(value).replaceAll("\\", "/");
}

function readStdin() {
	return new Promise((resolve) => {
		let input = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			input += chunk;
		});
		process.stdin.on("end", () => resolve(input));
		process.stdin.resume();
	});
}

function tryParseJson(input) {
	try {
		return JSON.parse(input);
	} catch {
		return undefined;
	}
}

function collectStrings(value, strings = []) {
	if (value == null) {
		return strings;
	}
	if (typeof value === "string") {
		strings.push(value);
		return strings;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectStrings(item, strings);
		return strings;
	}
	if (typeof value === "object") {
		for (const [key, nested] of Object.entries(value)) {
			strings.push(key);
			collectStrings(nested, strings);
		}
	}
	return strings;
}

function findProtectedPaths(strings) {
	const matches = new Set();
	for (const value of strings) {
		for (const matcher of protectedMatchers) {
			if (matcher.test(value)) matches.add(matcher.label);
		}
	}
	return [...matches];
}

function detectMutatingTool(strings) {
	return strings.some((value) => mutatingToolPatterns.some((pattern) => pattern.test(value)));
}

function hasExplicitOverride(strings) {
	const haystack = strings.join("\n");
	return explicitOverridePatterns.some((pattern) => pattern.test(haystack));
}

function outputAllow() {
	process.stdout.write(JSON.stringify({ continue: true }));
}

function outputAsk(paths) {
	process.stdout.write(
		JSON.stringify({
			continue: true,
			systemMessage: `Protected file edit detected: ${paths.join(", ")}. Explicit approval is required for generated files and package changelogs.`,
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "ask",
				permissionDecisionReason:
					"This repo protects generated files and package changelogs from accidental edits. Approve only if the user explicitly asked for this change.",
			},
		}),
	);
}

const input = await readStdin();
const parsed = tryParseJson(input);
const strings = parsed ? collectStrings(parsed) : [input];
const protectedPaths = findProtectedPaths(strings);

if (protectedPaths.length === 0 || !detectMutatingTool(strings)) {
	outputAllow();
	process.exit(0);
}

if (hasExplicitOverride(strings)) {
	outputAllow();
	process.exit(0);
}

outputAsk(protectedPaths);
