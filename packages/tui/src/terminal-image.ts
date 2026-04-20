/**
 * Compatibility shim — terminal image support now lives in `media/terminal-image.ts`.
 *
 * Internal consumers import from `"../terminal-image.js"`. This shim re-exports
 * the canonical location so existing imports continue to resolve.
 * Do NOT remove until a separate approved deprecation change.
 */
export {
	allocateImageId,
	type CellDimensions,
	calculateImageRows,
	deleteAllKittyImages,
	deleteKittyImage,
	detectCapabilities,
	encodeITerm2,
	encodeKitty,
	getCapabilities,
	getCellDimensions,
	getGifDimensions,
	getImageDimensions,
	getJpegDimensions,
	getPngDimensions,
	getWebpDimensions,
	hyperlink,
	type ImageDimensions,
	type ImageProtocol,
	type ImageRenderOptions,
	imageFallback,
	isImageLine,
	renderImage,
	resetCapabilitiesCache,
	setCapabilities,
	setCellDimensions,
	type TerminalCapabilities,
} from "./media/terminal-image.js";
