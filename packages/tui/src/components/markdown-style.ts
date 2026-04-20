/**
 * Style-prefix extraction helpers for the markdown renderer.
 *
 * When the text wrapper ({@link wrapTextWithAnsi}) breaks a styled line,
 * subsequent continuation lines lose the ANSI style prefix. These helpers
 * compute the prefix so the renderer can re-apply it after each line break.
 *
 * The technique works by styling a sentinel character and extracting the
 * ANSI escape bytes that precede it.
 */

/**
 * Extract the ANSI style prefix that a styling function prepends to its input.
 *
 * Applies `styleFn` to a NUL sentinel, then returns everything before
 * the sentinel. If the function inserts nothing before the sentinel an
 * empty string is returned.
 *
 * @example
 * ```ts
 * const prefix = extractStylePrefix(chalk.bold);
 * // prefix === "\x1b[1m"
 * ```
 */
export function extractStylePrefix(styleFn: (text: string) => string): string {
	const sentinel = "\u0000";
	const styled = styleFn(sentinel);
	const sentinelIndex = styled.indexOf(sentinel);
	return sentinelIndex >= 0 ? styled.slice(0, sentinelIndex) : "";
}

/**
 * Compute the combined ANSI style prefix from multiple optional style
 * functions applied in order. Skips null/undefined entries.
 *
 * This is used by the markdown renderer to compute the aggregate prefix
 * for default text style (foreground color + bold + italic + ...).
 */
export function extractCombinedStylePrefix(styleFns: Array<((text: string) => string) | undefined | null>): string {
	const sentinel = "\u0000";
	let styled = sentinel;
	for (const fn of styleFns) {
		if (fn) styled = fn(styled);
	}
	const sentinelIndex = styled.indexOf(sentinel);
	return sentinelIndex >= 0 ? styled.slice(0, sentinelIndex) : "";
}
