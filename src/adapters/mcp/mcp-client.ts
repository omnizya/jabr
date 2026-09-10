import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
	ElicitRequestFormParams,
	ElicitRequestURLParams,
	ElicitResult,
} from "@modelcontextprotocol/sdk/types";
import {
	CallToolResultSchema,
	ElicitRequestSchema,
} from "@modelcontextprotocol/sdk/types";
import type {
	ElicitationPort,
	ElicitationRequest,
} from "@ports/elicitation-port";
import {
	HermesElicitationPort,
	NullElicitationPort,
	ReadlineElicitationPort,
} from "@ports/elicitation-port";
import type { McpToolPort, McpToolResult } from "@ports/mcp-tool-port";

/**
 * McpClientAdapter implements McpToolPort by speaking the real MCP SDK protocol
 * (Client + StdioClientTransport) instead of the previous raw JSON-RPC stub.
 *
 * This unlocks:
 *   - Proper initialization handshake + capability negotiation
 *   - Schema-validated tool calls (input + output schemas)
 *   - Elicitation (form + URL mode) routed through ElicitationPort
 *
 * The MCP tool server is spawned as a Bun subprocess running
 * mcp-servers/tools.ts and communicates over stdio.
 */

export class McpClientAdapter implements McpToolPort {
	private client: Client | null = null;
	private transport: StdioClientTransport | null = null;

	/**
	 * The elicitation port decides how to surface a server's elicitation request
	 * on the active session's surface. Defaults to NullElicitationPort (decline)
	 * so headless/single-query runs don't hang waiting for input that will never
	 * arrive.
	 */
	private elicitationPort: ElicitationPort;

	constructor(
		elicitationPort: ElicitationPort = new ReadlineElicitationPort(),
	) {
		this.elicitationPort = elicitationPort;
	}

	/**
	 * Override the elicitation port after construction (e.g. wire a real gateway
	 * port in CLI mode, keep NullElicitationPort in single-query mode, or swap
	 * in HermesElicitationPort for gateway-driven prompt routing).
	 */
	setElicitationPort(port: ElicitationPort): void {
		this.elicitationPort = port;
	}

	private async ensureClient() {
		if (this.client) return;

		// StdioClientTransport spawns the MCP tool server as a Bun subprocess and
		// owns its lifecycle (start/close, stderr, pid). We do not spawn it here.
		const transport = new StdioClientTransport({
			command: "bun",
			args: ["mcp-servers/tools.ts"],
			// Pipe stderr so we can forward server logs for debugging without
			// inheriting the parent's stderr (which would corrupt the TUI).
			stderr: "pipe",
		});

		this.transport = transport;

		this.client = new Client(
			{ name: "jabr-mcp-client", version: "0.3.0" },
			{
				// Advertise elicitation form-mode support so the server knows this
				// client can receive elicitation/create requests.
				capabilities: {
					elicitation: { form: {}, url: {} },
				},
			},
		);

		// Wire the elicitation callback. The SDK calls this handler when the
		// server invokes elicitation/create during tool execution.
		this.client.setRequestHandler(
			ElicitRequestSchema,
			async (request, extra) => {
				return this.handleElicitation(request, extra);
			},
		);

		// Forward server stderr to our stderr so MCP server logs (FastMCP banners,
		// etc.) are visible for debugging.
		transport.stderr?.on("data", (chunk: any) => {
			process.stderr.write(chunk);
		});

		await this.client.connect(transport);

		// Clean up when the transport closes (server exits, etc.).
		transport.onclose = () => {
			this.client = null;
			this.transport = null;
		};
	}

	/**
	 * Handle an elicitation/create request from the server.
	 *
	 * The MCP SDK calls this handler inside the tool call's execution context,
	 * so tool calls block until the elicitation resolves.
	 */
	private async handleElicitation(
		request: unknown,
		_extra: any,
	): Promise<ElicitResult> {
		const params = request as {
			params: ElicitRequestFormParams | ElicitRequestURLParams;
		};

		const p = params.params;
		const mode: "form" | "url" = p.mode ?? "form";

		const elicitationRequest: ElicitationRequest = {
			mode,
			message: p.message || "",
			requestedSchema:
				p.mode === "form"
					? (p.requestedSchema as Record<string, unknown> | undefined)
					: undefined,
			url: p.mode === "url" ? (p.url as string | undefined) : undefined,
			elicitationId:
				p.mode === "url" ? (p.elicitationId as string | undefined) : undefined,
		};

		const timeoutMs = 300_000; // 5 min — mirrors Hermes' MCP elicitation default
		const decision = await this.elicitationPort.elicit(
			elicitationRequest,
			timeoutMs,
		);

		if (decision === "accept") {
			if (mode === "form" && elicitationRequest.requestedSchema) {
				// Build a minimal valid response from the schema's required fields.
				const schema = elicitationRequest.requestedSchema as {
					properties?: Record<string, { type?: string; default?: unknown }>;
					required?: string[];
				};
				const props = schema.properties || {};
				const required = schema.required || [];
				const content: Record<string, unknown> = {};
				for (const key of Object.keys(props)) {
					const prop = props[key]!;
					if (required.includes(key)) {
						content[key] =
							prop.default ?? (prop.type === "boolean" ? true : "");
					}
				}
				return { action: "accept", content } as ElicitResult;
			}
			return {
				action: "accept",
				content: mode === "form" ? {} : undefined,
			} as ElicitResult;
		}
		if (decision === "cancel") {
			return { action: "cancel" } as ElicitResult;
		}
		return { action: "decline" } as ElicitResult;
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
	): Promise<McpToolResult> {
		await this.ensureClient();
		if (!this.client || !this.transport) {
			return { content: "MCP client not initialized", isError: true };
		}

		try {
			const result = (await this.client.callTool(
				{ name, arguments: args },
				CallToolResultSchema,
			)) as {
				content?: Array<{ type?: string; text?: string }>;
				isError?: boolean;
			};

			const content = result.content?.[0]?.text || "";
			return {
				content,
				isError: result.isError === true,
			};
		} catch (e: any) {
			const message = e?.message || String(e);
			// Elicitation requests that the client declines will surface here as
			// errors propagated from the server-side tool that threw on decline.
			return { content: `MCP tool call failed: ${message}`, isError: true };
		}
	}
}
