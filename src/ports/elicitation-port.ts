/**
 * Elicitation callback port.
 *
 * MCP servers can pause tool execution mid-call and ask the client to collect
 * structured user input via elicitation/create (MCP SEP-2322). The client
 * surfaces the prompt on whatever surface owns the active session (CLI, TUI,
 * Telegram, Slack, etc.) and returns an ElicitResult.
 *
 * This port decouples the MCP client adapter from whatever surface currently
 * owns the session, so the same adapter works in CLI, TUI, and gateway contexts.
 */

import type {
	ElicitRequestFormParams,
	ElicitRequestURLParams,
	ElicitResult,
} from "@modelcontextprotocol/sdk/types";

export type ElicitationMode = "form" | "url";

export interface ElicitationRequest {
	/** Which elicitation mode the server requested. */
	mode: ElicitationMode;
	/** Human-readable description of what the server wants and why. */
	message: string;
	/** For form mode: the JSON Schema the server wants the user to fill in. */
	requestedSchema?: Record<string, unknown>;
	/** For URL mode: the URL the user should visit out-of-band. */
	url?: string;
	/** Server-provided opaque ID for tracking this elicitation. */
	elicitationId?: string;
}

/**
 * Normalized outcome returned by the elicitation port to the MCP client
 * adapter, which translates it back to an ElicitResult for the SDK.
 */
export type ElicitationDecision = "accept" | "decline" | "cancel";

/**
 * Implementations of this port are responsible for surfacing an elicitation
 * request on the active session's surface and collecting the user's decision.
 *
 * For CLI/TUI sessions this is a synchronous prompt. For gateway sessions
 * (Telegram/Slack/etc.) the implementation posts a message via the gateway's
 * notify callback and blocks until the user responds on that platform.
 *
 * Always fails closed: any timeout, exception, or missing surface returns
 * "decline" so the server treats it as "user did not approve".
 */
export interface ElicitationPort {
	/**
	 * Present the elicitation to the user and return their decision.
	 *
	 * @param request  The server's elicitation request.
	 * @param timeoutMs  Maximum time to wait for a user response (0 = no timeout).
	 * @returns        The user's decision: accept, decline, or cancel.
	 */
	elicit(
		request: ElicitationRequest,
		timeoutMs: number,
	): Promise<ElicitationDecision>;
}

/**
 * Default no-op port that declines every request. Used as a fallback when no
 * concrete port is wired (e.g. headless/single-query mode with no user waiting).
 */
export const NullElicitationPort: ElicitationPort = {
	async elicit(_request, _timeoutMs) {
		return "decline";
	},
};

// ── ReadlineElicitationPort ────────────────────────────────────────────

/**
 * CLI-mode elicitation port that prompts the user via stdin (readline).
 *
 * Renders the server's message, and for form-mode requests also renders the
 * JSON schema fields as labeled prompts. Captures yes/no (or y/n) for
 * approval decisions and free-text for memo/note fields.
 *
 * Always fails closed: any read error, EOF, or parse failure returns "decline".
 */
export class ReadlineElicitationPort implements ElicitationPort {
	private rl: import("node:readline").Interface | null = null;
	private resolve: (value: ElicitationDecision) => void = () => {};
	private reject: (error: Error) => void = () => {};
	private activePromise: Promise<ElicitationDecision> | null = null;

	async elicit(
		request: ElicitationRequest,
		timeoutMs: number,
	): Promise<ElicitationDecision> {
		if (this.activePromise) {
			// Nested elicitation — decline to avoid reentrancy.
			return "decline";
		}

		return new Promise((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;

			const timeout =
				timeoutMs > 0
					? setTimeout(() => {
							this.cleanup();
							resolve("decline");
						}, timeoutMs)
					: null;

			try {
				this.promptUser(request, () => {
					if (timeout) clearTimeout(timeout);
				});
			} catch (e) {
				this.cleanup();
				resolve("decline");
			}

			this.activePromise = new Promise((r) => {
				const origResolve = this.resolve;
				this.resolve = (v) => {
					this.cleanup();
					r(v);
				};
			});
		});
	}

	private cleanup(): void {
		if (this.rl) {
			this.rl.close();
			this.rl = null;
		}
		this.activePromise = null;
	}

	private promptUser(request: ElicitationRequest, onDone: () => void): void {
		const { createInterface } = require("node:readline");

		const promptLines: string[] = [];
		promptLines.push(`\n${"-".repeat(60)}`);
		promptLines.push(`ELICITATION: ${request.message}`);

		if (request.mode === "url" && request.url) {
			promptLines.push(`URL: ${request.url}`);
			promptLines.push(`[y]es / [n]o / [c]ancel:`);
		} else if (request.mode === "form" && request.requestedSchema) {
			const props =
				(
					request.requestedSchema as {
						properties?: Record<
							string,
							{ title?: string; description?: string; type?: string }
						>;
					}
				).properties || {};
			for (const [key, schema] of Object.entries(props)) {
				const title = (schema as { title?: string }).title || key;
				const desc = (schema as { description?: string }).description || "";
				promptLines.push(`  ${title}${desc ? ` — ${desc}` : ""}`);
			}
			promptLines.push(`[y]es / [n]o / [c]ancel:`);
		} else {
			promptLines.push(`[y]es / [n]o / [c]ancel:`);
		}

		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		this.rl = rl;
		rl.setPrompt("");

		for (const line of promptLines) {
			rl.write(line + "\n");
		}
		rl.prompt();

		rl.once("line", (input: string) => {
			const trimmed = input.trim().toLowerCase();
			if (trimmed === "y" || trimmed === "yes") {
				this.resolve("accept");
			} else if (trimmed === "c" || trimmed === "cancel") {
				this.resolve("cancel");
			} else {
				this.resolve("decline");
			}
			onDone();
		});

		rl.once("close", () => {
			this.resolve("decline");
			onDone();
		});
	}
}

// ── HermesElicitationPort ──────────────────────────────────────────────

/**
 * Gateway-mode elicitation port that surfaces the request via Hermes Kanban.
 *
 * Posts the elicitation as a Kanban task comment on the active session's task,
 * then polls for a response. This is the bridge between the MCP server's
 * in-band elicitation and the Hermes surface where the user is actually
 * working.
 *
 * Falls back to declining if the Hermes CLI is unavailable or the response
 * times out.
 */
export class HermesElicitationPort implements ElicitationPort {
	private pendingRequests = new Map<
		string,
		{
			resolve: (v: ElicitationDecision) => void;
			timeout: ReturnType<typeof setTimeout>;
		}
	>();

	async elicit(
		request: ElicitationRequest,
		timeoutMs: number,
	): Promise<ElicitationDecision> {
		if (!this.isHermesAvailable()) {
			return "decline";
		}

		return new Promise((resolve) => {
			const timeout = setTimeout(
				() => {
					this.pendingRequests.delete(request.elicitationId || "");
					resolve("decline");
				},
				timeoutMs > 0 ? timeoutMs : 300_000,
			);

			this.pendingRequests.set(request.elicitationId || "", {
				resolve,
				timeout,
			});

			this.postToHermes(request).catch(() => {
				resolve("decline");
			});
		});
	}

	private isHermesAvailable(): boolean {
		try {
			const { execSync } = require("node:child_process");
			execSync("hermes --version", { stdio: "ignore", timeout: 5_000 });
			return true;
		} catch {
			return false;
		}
	}

	private async postToHermes(request: ElicitationRequest): Promise<void> {
		const { execSync } = require("node:child_process");
		const taskId = process.env.HERMES_KANBAN_TASK;
		if (!taskId) {
			throw new Error("HERMES_KANBAN_TASK not set — cannot post elicitation");
		}

		const modeLabel = request.mode === "url" ? "URL auth" : "Form input";
		const prompt = [
			`## Elicitation Request`,
			`**Mode:** ${modeLabel}`,
			`**Message:** ${request.message}`,
			request.url ? `**URL:** \`${request.url}\`` : null,
			request.elicitationId ? `**Request ID:** ${request.elicitationId}` : null,
			`**Reply with:** \`approve\`, \`decline\`, or \`cancel\``,
		]
			.filter(Boolean)
			.join("\n");

		try {
			execSync(
				`hermes kanban comment --json "${taskId}" --body "${prompt.replace(/"/g, '\\"')}"`,
				{
					stdio: "pipe",
					timeout: 10_000,
				},
			);
		} catch {
			throw new Error("Failed to post elicitation to Kanban");
		}
	}

	/**
	 * Called when the user responds via the Hermes surface (e.g. kanban comment).
	 * In a full implementation this would be wired to a webhook or file-watcher
	 * watching for the user's reply on the Kanban task.
	 */
	resolveRequest(elicitationId: string, decision: ElicitationDecision): void {
		const pending = this.pendingRequests.get(elicitationId);
		if (!pending) return;
		clearTimeout(pending.timeout);
		this.pendingRequests.delete(elicitationId);
		pending.resolve(decision);
	}
}
