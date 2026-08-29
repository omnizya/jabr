import { McpClientAdapter } from "@adapters/mcp-client";
import { ScientistAgent } from "@core/scientist";
import { A2AServer } from "@adapters/http/a2a-server";

const port = 4006;
const mcpClient = new McpClientAdapter();
const scientist = new ScientistAgent(mcpClient);

const server = new A2AServer({
  port,
  card: scientist.card,
  async onTask(message: string): Promise<string> {
    const taskId = crypto.randomUUID();
    console.log(`[Run:Scientist] received task ${taskId}`);
    const result = await scientist.execute(taskId, message);
    return result;
  },
});

server.start();
