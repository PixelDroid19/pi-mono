/**
 * Resource path normalization for CLI flags.
 *
 * Extension, skill, prompt-template, and theme flags accept both local paths
 * and package identifiers. Only local-looking values are resolved against the
 * startup cwd; registry/package identifiers must stay unchanged so the resource
 * loader can resolve them through its normal package pipeline.
 */

import { resolve } from "node:path";
import { isLocalPath } from "../../utils/paths.js";

/**
 * Resolve only local path arguments against the cwd used to launch the CLI.
 */
export function resolveCliPaths(cwd: string, paths: string[] | undefined): string[] | undefined {
	return paths?.map((value) => (isLocalPath(value) ? resolve(cwd, value) : value));
}
