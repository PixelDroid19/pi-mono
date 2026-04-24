/**
 * Startup notices, changelog display, and initialization helpers
 * extracted from InteractiveMode.
 *
 * These are display-only helpers that don't mutate InteractiveMode state directly.
 * The InteractiveMode class calls these and applies results to its UI containers.
 */

import { getChangelogPath, getNewEntries, parseChangelog } from "../../../utils/changelog.js";

/**
 * Determine changelog entries to display on startup.
 * Returns markdown string of new entries, or undefined if nothing to show.
 */
export function getChangelogForDisplay(
	currentVersion: string,
	hasExistingMessages: boolean,
	getLastVersion: () => string | undefined,
	setLastVersion: (version: string) => void,
	reportInstall: (version: string) => void,
): string | undefined {
	// Skip changelog for resumed/continued sessions
	if (hasExistingMessages) {
		return undefined;
	}

	const lastVersion = getLastVersion();
	const changelogPath = getChangelogPath();
	const entries = parseChangelog(changelogPath);

	if (!lastVersion) {
		// Fresh install
		setLastVersion(currentVersion);
		reportInstall(currentVersion);
		return undefined;
	}

	const newEntries = getNewEntries(entries, lastVersion);
	if (newEntries.length > 0) {
		setLastVersion(currentVersion);
		reportInstall(currentVersion);
		return newEntries.map((e) => e.content).join("\n\n");
	}

	return undefined;
}

/**
 * Check npm registry for a newer version.
 * Returns the new version string, or undefined.
 */
export async function checkForNewVersion(currentVersion: string): Promise<string | undefined> {
	if (process.env.PI_SKIP_VERSION_CHECK || process.env.PI_OFFLINE) return undefined;

	try {
		const response = await fetch("https://registry.npmjs.org/@mariozechner/pi-coding-agent/latest", {
			signal: AbortSignal.timeout(10000),
		});
		if (!response.ok) return undefined;

		const data = (await response.json()) as { version?: string };
		const latestVersion = data.version;

		if (latestVersion && latestVersion !== currentVersion) {
			return latestVersion;
		}

		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * Report install telemetry if enabled.
 */
export function reportInstallTelemetry(version: string, isTelemetryEnabled: boolean): void {
	if (process.env.PI_OFFLINE) {
		return;
	}

	if (!isTelemetryEnabled) {
		return;
	}

	void fetch(`https://pi.dev/install?version=${encodeURIComponent(version)}`, {
		signal: AbortSignal.timeout(5000),
	})
		.then(() => undefined)
		.catch(() => undefined);
}
