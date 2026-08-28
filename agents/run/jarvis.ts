import { NineRouterLlmAdapter } from "@adapters/llm/9router";
import { Search9Router } from "@adapters/search-9router";
import { McpClientAdapter } from "@adapters/mcp-client";
import { SkillFS } from "@adapters/skill-fs";
import { MemPalaceAdapter } from "@adapters/mem-palace";
import { HeadroomAdapter } from "@adapters/headroom";
import { HermesKanbanAdapter } from "@adapters/hermes-kanban";
import { A2AServer } from "@adapters/http/a2a-server";
import { JarvisAgent, JARVIS_CARD } from "@core/jarvis";

if (import.meta.main) {
  const port = 1337;
  const budget = new HeadroomAdapter();
  const llm = new NineRouterLlmAdapter(budget);
  const search = new Search9Router();
  const mcp = new McpClientAdapter();
  const skills = new SkillFS("skills");
  const palace = new MemPalaceAdapter();
  const kanban = new HermesKanbanAdapter(process.env.HERMES_KANBAN_BOARD);

  const jarvis = new JarvisAgent(llm, search, mcp, skills, palace, budget, kanban);

  const server = new A2AServer({
    port,
    card: { ...JARVIS_CARD, url: `http://localhost:${port}` },
    async onTask(text: string): Promise<string> {
      const taskId = crypto.randomUUID();
      await jarvis.execute(taskId, text);
      return `Jarvis processed: "${text}" — check logs for details.`;
    },
  });

  server.start();
}
