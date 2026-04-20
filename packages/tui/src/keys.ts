/**
 * Re-export shim — all keyboard input handling now lives in input/.
 *
 * This file exists so that internal imports like `from "../keys.js"` continue
 * to resolve without updating every consumer.
 */
export { Key, type KeyId } from "./input/key-types.js";
export { isKittyProtocolActive, matchesKey, parseKey, setKittyProtocolActive } from "./input/keys.js";
export { decodeKittyPrintable } from "./input/kitty-printable.js";
export { isKeyRelease, isKeyRepeat, type KeyEventType } from "./input/kitty-protocol.js";
