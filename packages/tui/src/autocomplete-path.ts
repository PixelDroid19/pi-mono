/**
 * Path-prefix parsing and completion-value construction helpers for
 * the autocomplete provider.
 *
 * These are pure functions used by {@link CombinedAutocompleteProvider}
 * to interpret user input (quoted paths, @-prefixed references, bare
 * paths) and build the completion value string that replaces the prefix
 * when a suggestion is applied.
 */

const PATH_DELIMITERS = new Set([" ", "\t", '"', "'", "="]);

/** Normalize backslashes to forward slashes for display. */
export function toDisplayPath(value: string): string {
	return value.replace(/\\/g, "/");
}

/** Escape special regex characters in a string. */
export function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert a user-typed path query into a regex pattern for `fd --full-path`.
 *
 * Slash-separated segments become regex separated by `[\\\\/]` so the
 * match works on both Unix and Windows paths. A trailing `/` in the
 * query maps to a trailing separator pattern.
 */
export function buildFdPathQuery(query: string): string {
	const normalized = toDisplayPath(query);
	if (!normalized.includes("/")) {
		return normalized;
	}

	const hasTrailingSeparator = normalized.endsWith("/");
	const trimmed = normalized.replace(/^\/+|\/+$/g, "");
	if (!trimmed) {
		return normalized;
	}

	const separatorPattern = "[\\\\/]";
	const segments = trimmed
		.split("/")
		.filter(Boolean)
		.map((segment) => escapeRegex(segment));
	if (segments.length === 0) {
		return normalized;
	}

	let pattern = segments.join(separatorPattern);
	if (hasTrailingSeparator) {
		pattern += separatorPattern;
	}
	return pattern;
}

/** Find the last PATH_DELIMITER index in `text`, or -1. */
export function findLastDelimiter(text: string): number {
	for (let i = text.length - 1; i >= 0; i -= 1) {
		if (PATH_DELIMITERS.has(text[i] ?? "")) {
			return i;
		}
	}
	return -1;
}

/**
 * Return the index of an unclosed `"` in `text`, or null if quotes are balanced.
 *
 * Tracks open/close toggling of double-quote characters and returns the
 * starting index of the last unclosed quote.
 */
export function findUnclosedQuoteStart(text: string): number | null {
	let inQuotes = false;
	let quoteStart = -1;

	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === '"') {
			inQuotes = !inQuotes;
			if (inQuotes) {
				quoteStart = i;
			}
		}
	}

	return inQuotes ? quoteStart : null;
}

/** True when `index` is 0 or the preceding character is a PATH_DELIMITER. */
export function isTokenStart(text: string, index: number): boolean {
	return index === 0 || PATH_DELIMITERS.has(text[index - 1] ?? "");
}

/**
 * Extract a quoted prefix from user input for autocomplete.
 *
 * Returns the substring starting from an unclosed `"` (or `@"`) that
 * begins at a token boundary, or null if no such prefix exists.
 */
export function extractQuotedPrefix(text: string): string | null {
	const quoteStart = findUnclosedQuoteStart(text);
	if (quoteStart === null) {
		return null;
	}

	if (quoteStart > 0 && text[quoteStart - 1] === "@") {
		if (!isTokenStart(text, quoteStart - 1)) {
			return null;
		}
		return text.slice(quoteStart - 1);
	}

	if (!isTokenStart(text, quoteStart)) {
		return null;
	}

	return text.slice(quoteStart);
}

/**
 * Decompose a raw autocomplete prefix into its constituent parts.
 *
 * Handles `@"path"`, `"path"`, `@path`, and bare `path` forms.
 */
export function parsePathPrefix(prefix: string): { rawPrefix: string; isAtPrefix: boolean; isQuotedPrefix: boolean } {
	if (prefix.startsWith('@"')) {
		return { rawPrefix: prefix.slice(2), isAtPrefix: true, isQuotedPrefix: true };
	}
	if (prefix.startsWith('"')) {
		return { rawPrefix: prefix.slice(1), isAtPrefix: false, isQuotedPrefix: true };
	}
	if (prefix.startsWith("@")) {
		return { rawPrefix: prefix.slice(1), isAtPrefix: true, isQuotedPrefix: false };
	}
	return { rawPrefix: prefix, isAtPrefix: false, isQuotedPrefix: false };
}

/**
 * Build the completion value string that replaces the user's prefix
 * in the editor when a suggestion is applied.
 *
 * Wraps the path in quotes when needed (the prefix was already quoted,
 * or the path contains spaces) and prepends `@` for attachment references.
 */
export function buildCompletionValue(
	path: string,
	options: { isDirectory: boolean; isAtPrefix: boolean; isQuotedPrefix: boolean },
): string {
	const needsQuotes = options.isQuotedPrefix || path.includes(" ");
	const prefix = options.isAtPrefix ? "@" : "";

	if (!needsQuotes) {
		return `${prefix}${path}`;
	}

	const openQuote = `${prefix}"`;
	const closeQuote = '"';
	return `${openQuote}${path}${closeQuote}`;
}
