import { McpClientAdapter } from "@agents/adapters/mcp-client";
import { ScientistAgent } from "@agents/core/scientist";
import { A2AServer } from "@agents/adapters/http/a2a-server";

const port = 4006;
const mcpClient = new McpClientAdapter();
const scientist = new ScientistAgent(mcpClient);

const server = new A2AServer({
  port,
  card: scientist.card,
  async onTask(message: string): Promise<string> {
    const result = await scientist.handleTask(message);
    return result;
  },
});

server.start();
