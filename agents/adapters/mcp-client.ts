import { spawn } from "node:child_process";
import type { McpToolPort, McpToolResult } from "@ports/mcp-tool-port";

export class McpClientAdapter implements McpToolPort {
  private process: any = null;

  private async ensureProcess() {
    if (this.process) return;

    // Spawns the MCP tool server using bun
    this.process = spawn("bun", ["mcp-servers/tools.ts"]);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    await this.ensureProcess();

    return new Promise((resolve) => {
      // Simple JSON-RPC style message for the stdio MCP server
      const request = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name, arguments: args },
      };

      this.process.stdout.once("data", (data: Buffer) => {
        try {
          const response = JSON.parse(data.toString());
          const content = response.result?.content?.[0]?.text || "No output";
          resolve({ content });
        } catch (e) {
          console.error(`[McpClient] failed to parse MCP response: ${e}`);
          resolve({ content: `Error parsing MCP response: ${e}`, isError: true });
        }
      });

      this.process.stdin.write(JSON.stringify(request) + "\n");
    });
  }
}
