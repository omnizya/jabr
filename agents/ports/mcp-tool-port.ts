export interface McpToolResult {
	content: string;
	isError?: boolean;
}

export interface McpToolPort {
	callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

console.log("[McpToolPort] port interface loaded");
