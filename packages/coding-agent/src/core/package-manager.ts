/**
 * Public package-manager facade.
 *
 * Resource discovery and installation/update execution are implemented under
 * package-manager-internal. This file keeps the stable package-manager import
 * path while making the implementation boundary explicit.
 */

export { DefaultPackageManager } from "./package-manager-internal/default-package-manager.js";
export type {
	ConfiguredPackage,
	MissingSourceAction,
	PackageManager,
	PackageUpdate,
	PathMetadata,
	ProgressCallback,
	ProgressEvent,
	ResolvedPaths,
	ResolvedResource,
} from "./package-manager-internal/resource-discovery.js";
