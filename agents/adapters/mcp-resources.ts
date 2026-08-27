
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import type { WorldState } from "@agents/types";
import type { SubscriptionManager } from "@adapters/subscription-manager";

export interface ResourceContext {
  getWorldState: () => Promise<WorldState>;
  getTask: (taskId: string) => Promise<unknown>;
  projectRoot: string;
  subscriptions: SubscriptionManager;
}

export function registerResources(server: McpServer, ctx: ResourceContext): void {
  const notifySubscribers = (uri: string): void => {
    if (ctx.subscriptions.hasSubscribers(uri)) {
      server.sendResourceListChanged();
    }
  };

  server.registerResource("world-state", "jabr://world-state", {
    description: "Current system state — agents, tasks, memory, skills",
    mimeType: "application/json",
  }, async () => {
    const state = await ctx.getWorldState();
    notifySubscribers("jabr://world-state");
    return {
      contents: [{
        uri: "jabr://world-state",
        text: JSON.stringify(state, null, 2),
        mimeType: "application/json",
      }],
    };
  });

  const taskTemplate = new ResourceTemplate("jabr://tasks/{taskId}", {
    list: async () => {
      return { resources: [] };
    },
  });

  server.registerResource("task", taskTemplate, {
    description: "Individual task state by task ID",
    mimeType: "application/json",
  }, async (uri: URL, variables: Record<string, string | string[]>) => {
    const raw = variables.taskId;
    const taskId = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
    const task = await ctx.getTask(taskId);
    notifySubscribers(uri.toString());
    return {
      contents: [{
        uri: uri.toString(),
        text: JSON.stringify(task, null, 2),
        mimeType: "application/json",
      }],
    };
  });

  server.registerResource("skills", "jabr://skills", {
    description: "All saved skills from the skill store",
    mimeType: "application/json",
  }, () => {
    const skillDir = join(ctx.projectRoot, "skills");
    if (!existsSync(skillDir)) {
      notifySubscribers("jabr://skills");
      return { contents: [{ uri: "jabr://skills", text: "[]", mimeType: "application/json" }] };
    }
    const files = readdirSync(skillDir).filter(f => f.endsWith(".json"));
    const skills = files.map(f => {
      try {
        return JSON.parse(readFileSync(join(skillDir, f), "utf-8"));
      } catch {
        return null;
      }
    }).filter(Boolean);
    notifySubscribers("jabr://skills");
    return {
      contents: [{ uri: "jabr://skills", text: JSON.stringify(skills, null, 2), mimeType: "application/json" }],
    };
  });

  server.registerResource("memory", "jabr://memory", {
    description: "Orchestrator session memory (append-only markdown)",
    mimeType: "text/markdown",
  }, () => {
    const memPath = join(ctx.projectRoot, "memory", "orchestrator.md");
    if (!existsSync(memPath)) {
      notifySubscribers("jabr://memory");
      return { contents: [{ uri: "jabr://memory", text: "# No memory yet", mimeType: "text/markdown" }] };
    }
    const content = readFileSync(memPath, "utf-8");
    notifySubscribers("jabr://memory");
    return { contents: [{ uri: "jabr://memory", text: content, mimeType: "text/markdown" }] };
  });
}
