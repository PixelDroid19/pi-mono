/**
 * Resource display and path formatting helpers extracted from InteractiveMode.
 *
 * Pure functions for formatting display paths, source info labels, scope groups,
 * and resource listings. No UI state mutation -- these return formatted strings.
 */

import * as os from "node:os";
import * as path from "node:path";
import type { SourceInfo } from "../../../core/source-info.js";
import { parseGitUrl } from "../../../utils/git.js";

/**
 * Replace home directory with ~ in a path.
 */
export function formatDisplayPath(p: string): string {
	const home = os.homedir();
	let result = p;
	if (result.startsWith(home)) {
		result = `~${result.slice(home.length)}`;
	}
	return result;
}

/**
 * Format a path relative to the session cwd, falling back to display path.
 */
export function formatContextPath(p: string, sessionCwd: string): string {
	const cwd = path.resolve(sessionCwd);
	const absolutePath = path.isAbsolute(p) ? path.resolve(p) : path.resolve(cwd, p);
	const relativePath = path.relative(cwd, absolutePath);
	const isInsideCwd =
		relativePath === "" ||
		(!relativePath.startsWith("..") && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath));

	if (isInsideCwd) {
		return relativePath || ".";
	}

	return formatDisplayPath(absolutePath);
}

/**
 * Check if a source is from a package (npm: or git:).
 */
export function isPackageSource(sourceInfo?: SourceInfo): boolean {
	const source = sourceInfo?.source ?? "";
	return source.startsWith("npm:") || source.startsWith("git:");
}

/**
 * Get the scope group for a source info.
 */
export function getScopeGroup(sourceInfo?: SourceInfo): "user" | "project" | "path" {
	const source = sourceInfo?.source ?? "local";
	const scope = sourceInfo?.scope ?? "project";
	if (source === "cli" || scope === "temporary") return "path";
	if (scope === "user") return "user";
	if (scope === "project") return "project";
	return "path";
}

/**
 * Get display information for a source info entry.
 */
export function getDisplaySourceInfo(sourceInfo?: SourceInfo): {
	label: string;
	scopeLabel?: string;
	color: "accent" | "muted";
} {
	const source = sourceInfo?.source ?? "local";
	const scope = sourceInfo?.scope ?? "project";
	if (source === "local") {
		if (scope === "user") {
			return { label: "user", color: "muted" };
		}
		if (scope === "project") {
			return { label: "project", color: "muted" };
		}
		if (scope === "temporary") {
			return { label: "path", scopeLabel: "temp", color: "muted" };
		}
		return { label: "path", color: "muted" };
	}

	if (source === "cli") {
		return { label: "path", scopeLabel: scope === "temporary" ? "temp" : undefined, color: "muted" };
	}

	const scopeLabel =
		scope === "user" ? "user" : scope === "project" ? "project" : scope === "temporary" ? "temp" : undefined;
	return { label: source, scopeLabel, color: "accent" };
}

/**
 * Get a short path relative to the package root for display.
 */
export function getShortPath(fullPath: string, sourceInfo?: SourceInfo): string {
	const baseDir = sourceInfo?.baseDir;
	if (baseDir && isPackageSource(sourceInfo)) {
		const relativePath = path.relative(path.resolve(baseDir), path.resolve(fullPath));
		if (
			relativePath &&
			relativePath !== "." &&
			!relativePath.startsWith("..") &&
			!relativePath.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relativePath)
		) {
			return relativePath.replace(/\\/g, "/");
		}
	}

	const source = sourceInfo?.source ?? "";
	const npmMatch = fullPath.match(/node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/);
	if (npmMatch && source.startsWith("npm:")) {
		return npmMatch[2];
	}

	const gitMatch = fullPath.match(/git\/[^/]+\/[^/]+\/(.*)/);
	if (gitMatch && source.startsWith("git:")) {
		return gitMatch[1];
	}

	return formatDisplayPath(fullPath);
}

/**
 * Get an autocomplete source tag string.
 */
export function getAutocompleteSourceTag(sourceInfo?: SourceInfo): string | undefined {
	if (!sourceInfo) {
		return undefined;
	}

	const scopePrefix = sourceInfo.scope === "user" ? "u" : sourceInfo.scope === "project" ? "p" : "t";
	const source = sourceInfo.source.trim();

	if (source === "auto" || source === "local" || source === "cli") {
		return scopePrefix;
	}

	if (source.startsWith("npm:")) {
		return `${scopePrefix}:${source}`;
	}

	const gitSource = parseGitUrl(source);
	if (gitSource) {
		const ref = gitSource.ref ? `@${gitSource.ref}` : "";
		return `${scopePrefix}:git:${gitSource.host}/${gitSource.path}${ref}`;
	}

	return scopePrefix;
}
