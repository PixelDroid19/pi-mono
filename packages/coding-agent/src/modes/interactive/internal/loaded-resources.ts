/**
 * Loaded resource presentation for InteractiveMode startup and reload output.
 *
 * The loader and resource registries live in AgentSession. This module turns
 * those registry results into terminal components, including compact startup
 * summaries, expanded resource lists, and collision diagnostics grouped by
 * source scope.
 */

import * as path from "node:path";
import type { Container } from "@mariozechner/pi-tui";
import { Spacer, Text } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { ExtensionRunner } from "../../../core/extensions/index.js";
import type { ResourceDiagnostic } from "../../../core/resource-loader.js";
import type { SettingsManager } from "../../../core/settings-manager.js";
import { BUILTIN_SLASH_COMMANDS } from "../../../core/slash-commands.js";
import type { SourceInfo } from "../../../core/source-info.js";
import { parseGitUrl } from "../../../utils/git.js";
import { ExpandableText } from "../components/expandable-text.js";
import { type ThemeColor, theme } from "../theme/theme.js";
import {
	formatContextPath,
	formatDisplayPath,
	getDisplaySourceInfo,
	getScopeGroup,
	getShortPath,
	isPackageSource,
} from "./resource-display.js";

interface LoadedResourcesTarget {
	chatContainer: Container;
	optionsVerbose: boolean | undefined;
	session: AgentSession;
	sessionCwd: string;
	settingsManager: SettingsManager;
	toolOutputExpanded: boolean;
}

interface LoadedResourcePath {
	path: string;
	sourceInfo?: SourceInfo;
}

interface ScopeGroup {
	scope: "user" | "project" | "path";
	paths: LoadedResourcePath[];
	packages: Map<string, LoadedResourcePath[]>;
}

export interface ShowLoadedResourcesOptions {
	extensions?: LoadedResourcePath[];
	force?: boolean;
	showDiagnosticsWhenQuiet?: boolean;
}

/**
 * Dependencies required to render loaded resources without exposing the full
 * InteractiveMode class to this presentation module.
 */
export interface LoadedResourcesHost {
	chatContainer: Container;
	optionsVerbose: boolean | undefined;
	session: AgentSession;
	sessionManager: { getCwd(): string };
	settingsManager: SettingsManager;
	toolOutputExpanded: boolean;
}

function getStartupExpansionState(target: LoadedResourcesTarget): boolean {
	return target.optionsVerbose === true || target.toolOutputExpanded;
}

function formatExtensionDisplayPath(resourcePath: string): string {
	return formatDisplayPath(resourcePath)
		.replace(/\/index\.ts$/, "")
		.replace(/\/index\.js$/, "");
}

function getCompactPathLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
	const shortPath = getShortPath(resourcePath, sourceInfo);
	const normalizedPath = shortPath.replace(/\\/g, "/");
	const segments = normalizedPath.split("/").filter((segment) => segment.length > 0 && segment !== "~");
	return segments[segments.length - 1] ?? shortPath;
}

function getCompactPackageSourceLabel(sourceInfo?: SourceInfo): string {
	const source = sourceInfo?.source ?? "";
	if (source.startsWith("npm:")) {
		return source.slice("npm:".length) || source;
	}

	const gitSource = parseGitUrl(source);
	if (gitSource) {
		return gitSource.path || source;
	}

	return source;
}

function getCompactExtensionLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
	if (!isPackageSource(sourceInfo)) {
		return getCompactPathLabel(resourcePath, sourceInfo);
	}

	const sourceLabel = getCompactPackageSourceLabel(sourceInfo);
	if (!sourceLabel) {
		return getCompactPathLabel(resourcePath, sourceInfo);
	}

	const shortPath = getShortPath(resourcePath, sourceInfo).replace(/\\/g, "/");
	const packagePath = shortPath.startsWith("extensions/") ? shortPath.slice("extensions/".length) : shortPath;
	const parsedPath = path.posix.parse(packagePath);

	if (parsedPath.name === "index") {
		return !parsedPath.dir || parsedPath.dir === "." ? sourceLabel : `${sourceLabel}:${parsedPath.dir}`;
	}

	return `${sourceLabel}:${packagePath}`;
}

function getCompactDisplayPathSegments(resourcePath: string): string[] {
	return formatDisplayPath(resourcePath)
		.replace(/\\/g, "/")
		.split("/")
		.filter((segment) => segment.length > 0 && segment !== "~");
}

function getCompactNonPackageExtensionLabel(
	resourcePath: string,
	index: number,
	allPaths: Array<{ path: string; segments: string[] }>,
): string {
	const segments = allPaths[index]?.segments;
	if (!segments || segments.length === 0) {
		return getCompactPathLabel(resourcePath);
	}

	for (let segmentCount = 1; segmentCount <= segments.length; segmentCount += 1) {
		const candidate = segments.slice(-segmentCount).join("/");
		const isUnique = allPaths.every((item, itemIndex) => {
			if (itemIndex === index) {
				return true;
			}
			return item.segments.slice(-segmentCount).join("/") !== candidate;
		});

		if (isUnique) {
			return candidate;
		}
	}

	return segments.join("/");
}

function getCompactExtensionLabels(extensions: LoadedResourcePath[]): string[] {
	const nonPackageExtensions = extensions
		.map((extension) => {
			const segments = getCompactDisplayPathSegments(extension.path);
			const lastSegment = segments[segments.length - 1];
			if (segments.length > 1 && (lastSegment === "index.ts" || lastSegment === "index.js")) {
				segments.pop();
			}
			return {
				path: extension.path,
				sourceInfo: extension.sourceInfo,
				segments,
			};
		})
		.filter((extension) => !isPackageSource(extension.sourceInfo));

	return extensions.map((extension) => {
		if (isPackageSource(extension.sourceInfo)) {
			return getCompactExtensionLabel(extension.path, extension.sourceInfo);
		}

		const nonPackageIndex = nonPackageExtensions.findIndex((item) => item.path === extension.path);
		if (nonPackageIndex === -1) {
			return getCompactPathLabel(extension.path, extension.sourceInfo);
		}

		return getCompactNonPackageExtensionLabel(extension.path, nonPackageIndex, nonPackageExtensions);
	});
}

function buildScopeGroups(items: LoadedResourcePath[]): ScopeGroup[] {
	const groups: Record<"user" | "project" | "path", ScopeGroup> = {
		user: { scope: "user", paths: [], packages: new Map() },
		project: { scope: "project", paths: [], packages: new Map() },
		path: { scope: "path", paths: [], packages: new Map() },
	};

	for (const item of items) {
		const group = groups[getScopeGroup(item.sourceInfo)];
		const source = item.sourceInfo?.source ?? "local";

		if (isPackageSource(item.sourceInfo)) {
			const list = group.packages.get(source) ?? [];
			list.push(item);
			group.packages.set(source, list);
		} else {
			group.paths.push(item);
		}
	}

	return [groups.project, groups.user, groups.path].filter(
		(group) => group.paths.length > 0 || group.packages.size > 0,
	);
}

function formatScopeGroups(
	groups: ScopeGroup[],
	options: {
		formatPackagePath: (item: LoadedResourcePath, source: string) => string;
		formatPath: (item: LoadedResourcePath) => string;
	},
): string {
	const lines: string[] = [];

	for (const group of groups) {
		lines.push(`  ${theme.fg("accent", group.scope)}`);

		const sortedPaths = [...group.paths].sort((a, b) => a.path.localeCompare(b.path));
		for (const item of sortedPaths) {
			lines.push(theme.fg("dim", `    ${options.formatPath(item)}`));
		}

		const sortedPackages = Array.from(group.packages.entries()).sort(([a], [b]) => a.localeCompare(b));
		for (const [source, items] of sortedPackages) {
			lines.push(`    ${theme.fg("mdLink", source)}`);
			const sortedPackagePaths = [...items].sort((a, b) => a.path.localeCompare(b.path));
			for (const item of sortedPackagePaths) {
				lines.push(theme.fg("dim", `      ${options.formatPackagePath(item, source)}`));
			}
		}
	}

	return lines.join("\n");
}

function findSourceInfoForPath(resourcePath: string, sourceInfos: Map<string, SourceInfo>): SourceInfo | undefined {
	const exact = sourceInfos.get(resourcePath);
	if (exact) return exact;

	let current = resourcePath;
	while (current.includes("/")) {
		current = current.substring(0, current.lastIndexOf("/"));
		const parent = sourceInfos.get(current);
		if (parent) return parent;
	}

	return undefined;
}

function formatPathWithSource(resourcePath: string, sourceInfo?: SourceInfo): string {
	if (sourceInfo) {
		const shortPath = getShortPath(resourcePath, sourceInfo);
		const { label, scopeLabel } = getDisplaySourceInfo(sourceInfo);
		const labelText = scopeLabel ? `${label} (${scopeLabel})` : label;
		return `${labelText} ${shortPath}`;
	}
	return formatDisplayPath(resourcePath);
}

function formatDiagnostics(diagnostics: readonly ResourceDiagnostic[], sourceInfos: Map<string, SourceInfo>): string {
	const lines: string[] = [];
	const collisions = new Map<string, ResourceDiagnostic[]>();
	const otherDiagnostics: ResourceDiagnostic[] = [];

	for (const diagnostic of diagnostics) {
		if (diagnostic.type === "collision" && diagnostic.collision) {
			const list = collisions.get(diagnostic.collision.name) ?? [];
			list.push(diagnostic);
			collisions.set(diagnostic.collision.name, list);
		} else {
			otherDiagnostics.push(diagnostic);
		}
	}

	for (const [name, collisionList] of collisions) {
		const first = collisionList[0]?.collision;
		if (!first) continue;
		lines.push(theme.fg("warning", `  "${name}" collision:`));
		lines.push(
			theme.fg(
				"dim",
				`    ${theme.fg("success", "✓")} ${formatPathWithSource(first.winnerPath, findSourceInfoForPath(first.winnerPath, sourceInfos))}`,
			),
		);
		for (const diagnostic of collisionList) {
			if (diagnostic.collision) {
				lines.push(
					theme.fg(
						"dim",
						`    ${theme.fg("warning", "✗")} ${formatPathWithSource(diagnostic.collision.loserPath, findSourceInfoForPath(diagnostic.collision.loserPath, sourceInfos))} (skipped)`,
					),
				);
			}
		}
	}

	for (const diagnostic of otherDiagnostics) {
		if (diagnostic.path) {
			const formattedPath = formatPathWithSource(
				diagnostic.path,
				findSourceInfoForPath(diagnostic.path, sourceInfos),
			);
			lines.push(theme.fg(diagnostic.type === "error" ? "error" : "warning", `  ${formattedPath}`));
			lines.push(theme.fg(diagnostic.type === "error" ? "error" : "warning", `    ${diagnostic.message}`));
		} else {
			lines.push(theme.fg(diagnostic.type === "error" ? "error" : "warning", `  ${diagnostic.message}`));
		}
	}

	return lines.join("\n");
}

function getBuiltInCommandConflictDiagnostics(extensionRunner: ExtensionRunner): ResourceDiagnostic[] {
	const builtinNames = new Set(BUILTIN_SLASH_COMMANDS.map((command) => command.name));
	return extensionRunner
		.getRegisteredCommands()
		.filter((command) => builtinNames.has(command.name))
		.map((command) => ({
			type: "warning" as const,
			message:
				command.invocationName === command.name
					? `Extension command '/${command.name}' conflicts with built-in interactive command. Skipping in autocomplete.`
					: `Extension command '/${command.name}' conflicts with built-in interactive command. Available as '/${command.invocationName}'.`,
			path: command.sourceInfo.path,
		}));
}

function addLoadedSection(
	target: LoadedResourcesTarget,
	name: string,
	collapsedBody: string,
	expandedBody = collapsedBody,
	color: ThemeColor = "mdHeading",
): void {
	const sectionHeader = (sectionName: string, sectionColor: ThemeColor = "mdHeading") =>
		theme.fg(sectionColor, `[${sectionName}]`);
	const section = new ExpandableText(
		() => `${sectionHeader(name, color)}\n${collapsedBody}`,
		() => `${sectionHeader(name, color)}\n${expandedBody}`,
		getStartupExpansionState(target),
		0,
		0,
	);
	target.chatContainer.addChild(section);
	target.chatContainer.addChild(new Spacer(1));
}

function formatCompactList(items: string[], options?: { sort?: boolean }): string {
	const labels = items.map((item) => item.trim()).filter((item) => item.length > 0);
	if (options?.sort !== false) {
		labels.sort((a, b) => a.localeCompare(b));
	}
	return theme.fg("dim", `  ${labels.join(", ")}`);
}

/** Render loaded resources and diagnostics into the interactive chat container. */
export function showLoadedResources(host: LoadedResourcesHost, options?: ShowLoadedResourcesOptions): void {
	const target: LoadedResourcesTarget = {
		chatContainer: host.chatContainer,
		optionsVerbose: host.optionsVerbose,
		session: host.session,
		sessionCwd: host.sessionManager.getCwd(),
		settingsManager: host.settingsManager,
		toolOutputExpanded: host.toolOutputExpanded,
	};
	const showListing = options?.force || target.optionsVerbose || !target.settingsManager.getQuietStartup();
	const showDiagnostics = showListing || options?.showDiagnosticsWhenQuiet === true;
	if (!showListing && !showDiagnostics) {
		return;
	}

	const skillsResult = target.session.resourceLoader.getSkills();
	const promptsResult = target.session.resourceLoader.getPrompts();
	const themesResult = target.session.resourceLoader.getThemes();
	const extensions =
		options?.extensions ??
		target.session.resourceLoader.getExtensions().extensions.map((extension) => ({
			path: extension.path,
			sourceInfo: extension.sourceInfo,
		}));
	const sourceInfos = new Map<string, SourceInfo>();
	for (const extension of extensions) {
		if (extension.sourceInfo) {
			sourceInfos.set(extension.path, extension.sourceInfo);
		}
	}
	for (const skill of skillsResult.skills) {
		if (skill.sourceInfo) {
			sourceInfos.set(skill.filePath, skill.sourceInfo);
		}
	}
	for (const prompt of promptsResult.prompts) {
		if (prompt.sourceInfo) {
			sourceInfos.set(prompt.filePath, prompt.sourceInfo);
		}
	}
	for (const loadedTheme of themesResult.themes) {
		if (loadedTheme.sourcePath && loadedTheme.sourceInfo) {
			sourceInfos.set(loadedTheme.sourcePath, loadedTheme.sourceInfo);
		}
	}

	if (showListing) {
		const contextFiles = target.session.resourceLoader.getAgentsFiles().agentsFiles;
		if (contextFiles.length > 0) {
			target.chatContainer.addChild(new Spacer(1));
			const contextList = contextFiles
				.map((file) => theme.fg("dim", `  ${formatDisplayPath(file.path)}`))
				.join("\n");
			const contextCompactList = formatCompactList(
				contextFiles.map((contextFile) => formatContextPath(contextFile.path, target.sessionCwd)),
				{ sort: false },
			);
			addLoadedSection(target, "Context", contextCompactList, contextList);
		}

		const skills = skillsResult.skills;
		if (skills.length > 0) {
			const groups = buildScopeGroups(
				skills.map((skill) => ({ path: skill.filePath, sourceInfo: skill.sourceInfo })),
			);
			const skillList = formatScopeGroups(groups, {
				formatPath: (item) => formatDisplayPath(item.path),
				formatPackagePath: (item) => getShortPath(item.path, item.sourceInfo),
			});
			const skillCompactList = formatCompactList(skills.map((skill) => skill.name));
			addLoadedSection(target, "Skills", skillCompactList, skillList);
		}

		const templates = target.session.promptTemplates;
		if (templates.length > 0) {
			const groups = buildScopeGroups(
				templates.map((template) => ({ path: template.filePath, sourceInfo: template.sourceInfo })),
			);
			const templateByPath = new Map(templates.map((template) => [template.filePath, template]));
			const templateList = formatScopeGroups(groups, {
				formatPath: (item) => {
					const template = templateByPath.get(item.path);
					return template ? `/${template.name}` : formatDisplayPath(item.path);
				},
				formatPackagePath: (item) => {
					const template = templateByPath.get(item.path);
					return template ? `/${template.name}` : formatDisplayPath(item.path);
				},
			});
			const promptCompactList = formatCompactList(templates.map((template) => `/${template.name}`));
			addLoadedSection(target, "Prompts", promptCompactList, templateList);
		}

		if (extensions.length > 0) {
			const groups = buildScopeGroups(extensions);
			const extList = formatScopeGroups(groups, {
				formatPath: (item) => formatExtensionDisplayPath(item.path),
				formatPackagePath: (item) => formatExtensionDisplayPath(getShortPath(item.path, item.sourceInfo)),
			});
			const extensionCompactList = formatCompactList(getCompactExtensionLabels(extensions));
			addLoadedSection(target, "Extensions", extensionCompactList, extList, "mdHeading");
		}

		const customThemes = themesResult.themes.filter((loadedTheme) => loadedTheme.sourcePath);
		if (customThemes.length > 0) {
			const groups = buildScopeGroups(
				customThemes.map((loadedTheme) => ({
					path: loadedTheme.sourcePath!,
					sourceInfo: loadedTheme.sourceInfo,
				})),
			);
			const themeList = formatScopeGroups(groups, {
				formatPath: (item) => formatDisplayPath(item.path),
				formatPackagePath: (item) => getShortPath(item.path, item.sourceInfo),
			});
			const themeCompactList = formatCompactList(
				customThemes.map(
					(loadedTheme) =>
						loadedTheme.name ?? getCompactPathLabel(loadedTheme.sourcePath!, loadedTheme.sourceInfo),
				),
			);
			addLoadedSection(target, "Themes", themeCompactList, themeList);
		}
	}

	if (showDiagnostics) {
		if (skillsResult.diagnostics.length > 0) {
			const warningLines = formatDiagnostics(skillsResult.diagnostics, sourceInfos);
			target.chatContainer.addChild(new Text(`${theme.fg("warning", "[Skill conflicts]")}\n${warningLines}`, 0, 0));
			target.chatContainer.addChild(new Spacer(1));
		}

		if (promptsResult.diagnostics.length > 0) {
			const warningLines = formatDiagnostics(promptsResult.diagnostics, sourceInfos);
			target.chatContainer.addChild(new Text(`${theme.fg("warning", "[Prompt conflicts]")}\n${warningLines}`, 0, 0));
			target.chatContainer.addChild(new Spacer(1));
		}

		const extensionDiagnostics: ResourceDiagnostic[] = [];
		const extensionErrors = target.session.resourceLoader.getExtensions().errors;
		for (const error of extensionErrors) {
			extensionDiagnostics.push({ type: "error", message: error.error, path: error.path });
		}
		extensionDiagnostics.push(...target.session.extensionRunner.getCommandDiagnostics());
		extensionDiagnostics.push(...getBuiltInCommandConflictDiagnostics(target.session.extensionRunner));
		extensionDiagnostics.push(...target.session.extensionRunner.getShortcutDiagnostics());

		if (extensionDiagnostics.length > 0) {
			const warningLines = formatDiagnostics(extensionDiagnostics, sourceInfos);
			target.chatContainer.addChild(new Text(`${theme.fg("warning", "[Extension issues]")}\n${warningLines}`, 0, 0));
			target.chatContainer.addChild(new Spacer(1));
		}

		if (themesResult.diagnostics.length > 0) {
			const warningLines = formatDiagnostics(themesResult.diagnostics, sourceInfos);
			target.chatContainer.addChild(new Text(`${theme.fg("warning", "[Theme conflicts]")}\n${warningLines}`, 0, 0));
			target.chatContainer.addChild(new Spacer(1));
		}
	}
}
