/**
 * Compatibility shim — keyboard input handling now lives in `input/`.
 *
 * Internal consumers import from `"../keys.js"`. This shim re-exports
 * the canonical locations so existing imports continue to resolve.
 * Do NOT remove until a separate approved deprecation change.
 */
export { Key, type KeyId } from "./input/key-types.js";
export { isKittyProtocolActive, matchesKey, parseKey, setKittyProtocolActive } from "./input/keys.js";
export { decodeKittyPrintable, decodePrintableKey } from "./input/kitty-printable.js";
export { isKeyRelease, isKeyRepeat, type KeyEventType } from "./input/kitty-protocol.js";
