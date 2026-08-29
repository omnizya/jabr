
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { WorldState } from "@agents/types";
import type { SubscriptionManager } from "@adapters/subscription-manager";

export interface ResourceContext {
  getWorldState: () => Promise<WorldState>;
  getTask: (taskId: string) => Promise<unknown>;
  projectRoot: string;
  subscriptions: SubscriptionManager;
}

export function registerResources(server: McpServer, ctx: ResourceContext): void {
  // Last-emitted content per URI. Lets us emit `notifications/resources/updated`
  // only when the underlying data actually changes, not on every read.
  const lastContent = new Map<string, string>();
  // Resource URIs we have already announced. Used to emit
  // `notifications/resources/list_changed` when the *set* of resources grows
  // (e.g. a previously-unseen task resource is first read).
  const knownUris = new Set<string>();

  // Content-change notification (the `subscribe` capability). Emitted only when
  // a subscriber exists and the content differs from the last emission.
  const notifyResourceUpdated = (uri: string, content: string): void => {
    const prev = lastContent.get(uri);
    lastContent.set(uri, content);
    if (!ctx.subscriptions.hasSubscribers(uri)) return;
    if (prev === content) return;
    server.server.sendResourceUpdated({ uri });
  };

  // Set-change notification (the `listChanged` capability). Emitted once per
  // newly-observed resource URI so clients can refresh their resource list.
  const notifyListChanged = (uri: string): void => {
    if (knownUris.has(uri)) return;
    knownUris.add(uri);
    server.sendResourceListChanged();
  };

  // Wire MCP subscribe/unsubscribe requests into the SubscriptionManager so that
  // `hasSubscribers` becomes meaningful and per-resource updated notifications
  // can actually be delivered. The SDK does not auto-handle these requests.
  server.server.setRequestHandler(SubscribeRequestSchema, (request) => {
    ctx.subscriptions.subscribe(request.params.uri);
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, (request) => {
    for (const id of ctx.subscriptions.getSubscriberIds(request.params.uri)) {
      ctx.subscriptions.unsubscribe(id);
    }
    return {};
  });

  server.registerResource("world-state", "jabr://world-state", {
    description: "Current system state — agents, tasks, memory, skills",
    mimeType: "application/json",
  }, async () => {
    const state = await ctx.getWorldState();
    const content = JSON.stringify(state, null, 2);
    notifyResourceUpdated("jabr://world-state", content);
    return {
      contents: [{
        uri: "jabr://world-state",
        text: content,
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
    const content = JSON.stringify(task, null, 2);
    // A new task resource expands the set of available resources.
    notifyListChanged(uri.toString());
    notifyResourceUpdated(uri.toString(), content);
    return {
      contents: [{
        uri: uri.toString(),
        text: content,
        mimeType: "application/json",
      }],
    };
  });

  server.registerResource("skills", "jabr://skills", {
    description: "All saved skills from the skill store",
    mimeType: "application/json",
  }, () => {
    const skillDir = join(ctx.projectRoot, "skills");
    let content: string;
    if (!existsSync(skillDir)) {
      content = "[]";
    } else {
      const files = readdirSync(skillDir).filter(f => f.endsWith(".json"));
      const skills = files.map(f => {
        try {
          return JSON.parse(readFileSync(join(skillDir, f), "utf-8"));
        } catch (e) {
          console.error(`[McpResources] failed to read skill file ${f}: ${e}`);
          return null;
        }
      }).filter(Boolean);
      content = JSON.stringify(skills, null, 2);
    }
    notifyResourceUpdated("jabr://skills", content);
    return {
      contents: [{ uri: "jabr://skills", text: content, mimeType: "application/json" }],
    };
  });

  server.registerResource("memory", "jabr://memory", {
    description: "Orchestrator session memory (append-only markdown)",
    mimeType: "text/markdown",
  }, () => {
    const memPath = join(ctx.projectRoot, "memory", "orchestrator.md");
    const content = existsSync(memPath)
      ? readFileSync(memPath, "utf-8")
      : "# No memory yet";
    notifyResourceUpdated("jabr://memory", content);
    return { contents: [{ uri: "jabr://memory", text: content, mimeType: "text/markdown" }] };
  });
}
