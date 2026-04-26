/**
 * Session information formatting for the interactive `/session` command.
 *
 * This helper keeps presentation strings and numeric formatting independent
 * from the TUI component that decides where the information is rendered.
 */

interface SessionTokenStats {
	cacheRead: number;
	cacheWrite: number;
	input: number;
	output: number;
	total: number;
}

interface SessionStatsSummary {
	assistantMessages: number;
	cost: number;
	sessionFile?: string;
	sessionId: string;
	tokens: SessionTokenStats;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	userMessages: number;
}

interface SessionInfoStyle {
	bold(text: string): string;
	dim(text: string): string;
}

/** Format the text body rendered by the interactive `/session` command. */
export function formatSessionInfo(
	stats: SessionStatsSummary,
	sessionName: string | undefined,
	style: SessionInfoStyle,
): string {
	let info = `${style.bold("Session Info")}\n\n`;
	if (sessionName) {
		info += `${style.dim("Name:")} ${sessionName}\n`;
	}
	info += `${style.dim("File:")} ${stats.sessionFile ?? "In-memory"}\n`;
	info += `${style.dim("ID:")} ${stats.sessionId}\n\n`;
	info += `${style.bold("Messages")}\n`;
	info += `${style.dim("User:")} ${stats.userMessages}\n`;
	info += `${style.dim("Assistant:")} ${stats.assistantMessages}\n`;
	info += `${style.dim("Tool Calls:")} ${stats.toolCalls}\n`;
	info += `${style.dim("Tool Results:")} ${stats.toolResults}\n`;
	info += `${style.dim("Total:")} ${stats.totalMessages}\n\n`;
	info += `${style.bold("Tokens")}\n`;
	info += `${style.dim("Input:")} ${stats.tokens.input.toLocaleString()}\n`;
	info += `${style.dim("Output:")} ${stats.tokens.output.toLocaleString()}\n`;
	if (stats.tokens.cacheRead > 0) {
		info += `${style.dim("Cache Read:")} ${stats.tokens.cacheRead.toLocaleString()}\n`;
	}
	if (stats.tokens.cacheWrite > 0) {
		info += `${style.dim("Cache Write:")} ${stats.tokens.cacheWrite.toLocaleString()}\n`;
	}
	info += `${style.dim("Total:")} ${stats.tokens.total.toLocaleString()}\n`;

	if (stats.cost > 0) {
		info += `\n${style.bold("Cost")}\n`;
		info += `${style.dim("Total:")} ${stats.cost.toFixed(4)}`;
	}

	return info;
}
