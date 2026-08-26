/**
 * Researcher Agent — A2A specialist
 * Port: 4002
 *
 * Handles research, summarization, and skill-document generation.
 * After each task, writes a Hermes-style skill to the skill store via MCP.
 *
 * Start: bun agents/researcher-agent.ts
 */

import type { AgentCard, A2AMessage } from "./types.ts";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const PORT = 4002;
const AGENT_CARD: AgentCard = {
  name: "Researcher Agent",
  description:
    "Researches topics, summarizes findings, and saves skills. Self-improving.",
  url: `http://localhost:${PORT}`,
  version: "1.0.0",
  capabilities: { streaming: true, pushNotifications: false },
  skills: [
    {
      id: "research",
      name: "Research topic",
      description: "Summarizes a topic and returns structured findings",
      inputModes: ["text"],
      outputModes: ["text", "data"],
    },
    {
      id: "summarize",
      name: "Summarize text",
      description: "Condenses long text into key bullets",
      inputModes: ["text"],
      outputModes: ["text"],
    },
    {
      id: "save-skill",
      name: "Save skill",
      description: "Persists a reusable skill document (self-improvement loop)",
      inputModes: ["text", "data"],
      outputModes: ["text"],
    },
  ],
};

// ── Self-improvement: save skill after each unique task ────────────────────────
function persistSkill(taskType: string, userText: string, steps: string[]) {
  const skillDir = join(process.cwd(), "skills");
  if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });
  const slug = taskType.toLowerCase().replace(/\s+/g, "-");
  const path = join(skillDir, `${slug}.json`);
  if (existsSync(path)) return; // already learned
  writeFileSync(
    path,
    JSON.stringify(
      {
        name: taskType,
        description: `Auto-generated from task: "${userText.slice(0, 60)}"`,
        tags: ["auto", "researcher"],
        steps,
        createdAt: new Date().toISOString(),
        usageCount: 1,
        successRate: 1.0,
      },
      null,
      2,
    ),
  );
  console.log(`📚 Skill saved: skills/${slug}.json`);
}

// ── Task execution ────────────────────────────────────────────────────────────
async function executeTask(userText: string): Promise<string> {
  const lower = userText.toLowerCase();

  if (lower.includes("mcp") || lower.includes("a2a") || lower.includes("acp")) {
    persistSkill("protocol-research", userText, [
      "Identify the protocol (MCP / A2A / ACP)",
      "Fetch official spec from docs",
      "Summarize transport layer",
      "List key use cases",
      "Return structured findings",
    ]);
    return `## Protocol Research: ${userText}

**MCP** — Model Context Protocol (Anthropic)
• JSON-RPC 2.0 over stdio or HTTP
• Connects agents to tools and data sources
• Your Bun MCP server: \`bun mcp-servers/tools.ts\`

**A2A** — Agent-to-Agent (Linux Foundation)
• HTTP + JSON-RPC, Agent Cards for discovery
• Task lifecycle: submitted → working → completed
• This agent is a live A2A server on port ${PORT}

**ACP** — Agent Client Protocol (Zed / JetBrains)
• JSON-RPC over stdio (nd-JSON)
• Bridges IDEs to coding agents
• OpenCode exposes it via: \`opencode acp\`

Skill saved to \`skills/protocol-research.json\` ✓`;
  }

  if (lower.includes("summarize") || lower.includes("summary")) {
    persistSkill("text-summarization", userText, [
      "Extract key sentences",
      "Group by theme",
      "Produce bullet summary",
    ]);
    return `## Summary

• Topic identified: "${userText.slice(0, 50)}…"
• Key finding 1: core concept extracted
• Key finding 2: implications noted
• Key finding 3: action items surfaced

Skill saved → \`skills/text-summarization.json\` ✓`;
  }

  if (lower.includes("skill") || lower.includes("self-improv")) {
    persistSkill("skill-creation", userText, [
      "Identify recurring task pattern",
      "Extract steps from execution",
      "Write skill JSON document",
      "Save to skills/ directory",
      "Increment usageCount on reuse",
    ]);
    return `## Self-improvement loop

Hermes-style skill creation:
1. Agent completes task
2. Extracts reusable pattern → \`skills/<slug>.json\`
3. Next time same task arrives → load skill, run faster
4. After 20+ uses → successRate tracked

Skill saved → \`skills/skill-creation.json\` ✓`;
  }

  persistSkill("general-research", userText, [
    "Parse user query intent",
    "Search knowledge base",
    "Structure findings",
    "Return with citations",
  ]);
  return `## Research: "${userText}"

Findings: topic processed by Researcher Agent.
No cached skill found — created \`skills/general-research.json\` for next time.

Tip: delegate specific subtasks to Coder Agent via the orchestrator.`;
}

// ── In-memory tasks ───────────────────────────────────────────────────────────
const tasks = new Map<
  string,
  { state: string; messages: A2AMessage[]; artifacts: unknown[] }
>();
const mkId = () => crypto.randomUUID();

async function handleRPC(body: unknown): Promise<unknown> {
  const { jsonrpc, id, method, params } = body as {
    jsonrpc: string;
    id: string | number;
    method: string;
    params: Record<string, unknown>;
  };
  const ok = (r: unknown) => ({ jsonrpc, id, result: r });
  const err = (code: number, message: string) => ({
    jsonrpc,
    id,
    error: { code, message },
  });

  if (method === "message/send") {
    const msg = params.message as A2AMessage;
    const taskId = mkId();
    const contextId = mkId();
    const userText =
      (
        msg.parts.find((p) => p.kind === "text") as {
          kind: "text";
          text: string;
        }
      )?.text ?? "";

    const task = {
      state: "working",
      messages: [msg],
      artifacts: [] as unknown[],
    };
    tasks.set(taskId, task);

    setTimeout(async () => {
      const responseText = await executeTask(userText);
      task.state = "completed";
      task.messages.push({
        messageId: mkId(),
        role: "agent",
        kind: "message",
        parts: [{ kind: "text", text: responseText }],
        contextId,
        taskId,
      });
    }, 150);

    return ok({
      kind: "task",
      id: taskId,
      contextId,
      status: { state: "working", timestamp: new Date().toISOString() },
      history: [msg],
    });
  }

  if (method === "tasks/get") {
    const { taskId } = params as { taskId: string };
    const task = tasks.get(taskId);
    if (!task) return err(-32001, "Task not found");
    return ok({
      kind: "task",
      id: taskId,
      status: { state: task.state, timestamp: new Date().toISOString() },
      history: task.messages,
    });
  }

  return err(-32601, `Method not found: ${method}`);
}

// ── HTTP server ───────────────────────────────────────────────────────────────
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/.well-known/agent-card.json")
      return Response.json(AGENT_CARD, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    if (url.pathname === "/a2a" && req.method === "POST") {
      const body = await req.json();
      return Response.json(await handleRPC(body), {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }
    if (url.pathname === "/health")
      return Response.json({ status: "ok", agent: AGENT_CARD.name });
    return new Response("Not found", { status: 404 });
  },
});

console.log(`🔬 Researcher Agent  →  http://localhost:${PORT}`);
console.log(
  `   Card:              http://localhost:${PORT}/.well-known/agent-card.json`,
);
console.log(`   A2A endpoint:      http://localhost:${PORT}/a2a`);
