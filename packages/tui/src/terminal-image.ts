/**
 * Re-export shim -- terminal image support now lives in media/terminal-image.ts.
 *
 * This file exists so that internal imports like `from "../terminal-image.js"`
 * continue to resolve without updating every consumer.
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
