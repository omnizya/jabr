/**
 * Orchestrator Agent — Hermes-style
 * Port: 4000
 *
 * Responsibilities:
 * - Discovers sub-agents via A2A Agent Card (/.well-known/agent-card.json)
 * - Routes tasks to correct specialist (Coder | Researcher)
 * - Tracks memory.md across sessions
 * - Writes skills after novel tasks (self-improvement loop)
 * - Exposes its own A2A endpoint for higher-level orchestrators
 *
 * Start: bun agents/orchestrator.ts
 */

import type { AgentCard } from "./types.ts";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const PORT = 4000;
const CODER_URL = "http://localhost:4001";
const RESEARCHER_URL = "http://localhost:4002";

// ── Memory (Hermes-style: persisted markdown) ─────────────────────────────────
const MEMORY_PATH = join(process.cwd(), "memory", "orchestrator.md");
mkdirSync(join(process.cwd(), "memory"), { recursive: true });

function readMemory(): string {
  return existsSync(MEMORY_PATH) ? readFileSync(MEMORY_PATH, "utf-8") : "";
}

function appendMemory(entry: string) {
  const ts = new Date().toISOString();
  const line = `\n- [${ts}] ${entry}`;
  writeFileSync(MEMORY_PATH, readMemory() + line);
}

// ── A2A client: discover + delegate ──────────────────────────────────────────
async function fetchAgentCard(baseUrl: string): Promise<AgentCard | null> {
  try {
    const res = await fetch(`${baseUrl}/.well-known/agent-card.json`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok ? ((await res.json()) as AgentCard) : null;
  } catch {
    return null;
  }
}

async function delegateTask(agentUrl: string, text: string): Promise<string> {
  const msgId = crypto.randomUUID();
  const payload = {
    jsonrpc: "2.0",
    id: msgId,
    method: "message/send",
    params: {
      message: {
        messageId: msgId,
        role: "user",
        kind: "message",
        parts: [{ kind: "text", text }],
        contextId: crypto.randomUUID(),
      },
    },
  };

  // Send task
  const sendRes = await fetch(`${agentUrl}/a2a`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const { result: task } = (await sendRes.json()) as { result: { id: string } };
  const taskId = task.id;

  // Poll until completed (simple polling — SSE streaming in production)
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(200);
    const pollRes = await fetch(`${agentUrl}/a2a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "tasks/get",
        params: { taskId },
      }),
    });
    const { result: polled } = (await pollRes.json()) as {
      result: {
        status: { state: string };
        history: Array<{
          role: string;
          parts: Array<{ kind: string; text: string }>;
        }>;
      };
    };

    if (
      polled.status.state === "completed" ||
      polled.status.state === "failed"
    ) {
      const agentMsg = polled.history.find((m) => m.role === "agent");
      return (
        agentMsg?.parts.find((p) => p.kind === "text")?.text ?? "(no response)"
      );
    }
  }
  return "(timeout waiting for agent)";
}

// ── Routing logic ─────────────────────────────────────────────────────────────
function routeTask(text: string): { url: string; label: string } {
  const lower = text.toLowerCase();
  const coderKeywords = [
    "code",
    "function",
    "implement",
    "fibonacci",
    "algorithm",
    "python",
    "typescript",
    "bug",
    "review",
    "write",
  ];
  const isCoder = coderKeywords.some((k) => lower.includes(k));
  return isCoder
    ? { url: CODER_URL, label: "Coder Agent" }
    : { url: RESEARCHER_URL, label: "Researcher Agent" };
}

// ── Orchestrator own A2A card ─────────────────────────────────────────────────
const AGENT_CARD: AgentCard = {
  name: "Orchestrator",
  description:
    "Hermes-style orchestrator. Discovers agents, routes tasks, persists memory, writes skills.",
  url: `http://localhost:${PORT}`,
  version: "1.0.0",
  capabilities: { streaming: false, pushNotifications: false },
  skills: [
    {
      id: "route-task",
      name: "Route task",
      description:
        "Classifies and delegates any task to the best specialist agent",
      inputModes: ["text"],
      outputModes: ["text"],
    },
    {
      id: "discover-agents",
      name: "Discover agents",
      description: "Fetches Agent Cards from known sub-agents",
      inputModes: ["text"],
      outputModes: ["data"],
    },
  ],
};

// ── JSON-RPC dispatcher ───────────────────────────────────────────────────────
const tasks = new Map<string, { state: string; result?: string }>();

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

  // ── message/send — main entry point ──────────────────────────────────────
  if (method === "message/send") {
    const msg = params.message as {
      parts: Array<{ kind: string; text: string }>;
    };
    const userText = msg.parts.find((p) => p.kind === "text")?.text ?? "";
    const taskId = crypto.randomUUID();
    const contextId = crypto.randomUUID();
    tasks.set(taskId, { state: "working" });

    console.log(`\n📨 Task received: "${userText}"`);

    // Async execution
    (async () => {
      try {
        const { url, label } = routeTask(userText);
        console.log(`   → Routing to ${label} (${url})`);
        appendMemory(`Routed "${userText.slice(0, 60)}" to ${label}`);

        const result = await delegateTask(url, userText);
        tasks.set(taskId, { state: "completed", result });
        appendMemory(`Completed task. Result length: ${result.length} chars`);
        console.log(`   ✓ Done (${result.length} chars)`);
      } catch (e) {
        tasks.set(taskId, { state: "failed", result: String(e) });
        console.error("   ✗ Failed:", e);
      }
    })();

    return ok({
      kind: "task",
      id: taskId,
      contextId,
      status: { state: "working", timestamp: new Date().toISOString() },
    });
  }

  // ── tasks/get ─────────────────────────────────────────────────────────────
  if (method === "tasks/get") {
    const { taskId } = params as { taskId: string };
    const task = tasks.get(taskId);
    if (!task) return err(-32001, "Task not found");
    return ok({
      kind: "task",
      id: taskId,
      status: { state: task.state, timestamp: new Date().toISOString() },
      history: task.result
        ? [
            {
              messageId: crypto.randomUUID(),
              role: "agent",
              kind: "message",
              parts: [{ kind: "text", text: task.result }],
              contextId: taskId,
            },
          ]
        : [],
    });
  }

  // ── discover — inspect sub-agent cards ───────────────────────────────────
  if (method === "discover") {
    const [coderCard, researcherCard] = await Promise.all([
      fetchAgentCard(CODER_URL),
      fetchAgentCard(RESEARCHER_URL),
    ]);
    return ok({ agents: [coderCard, researcherCard].filter(Boolean) });
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
    if (url.pathname === "/memory") {
      return new Response(readMemory() || "(empty)", {
        headers: { "Content-Type": "text/plain" },
      });
    }
    if (url.pathname === "/health")
      return Response.json({ status: "ok", agent: AGENT_CARD.name });
    return new Response("Not found", { status: 404 });
  },
});

// Boot — log sub-agent cards
console.log(`\n🧠 Orchestrator  →  http://localhost:${PORT}`);
console.log(`   A2A:           http://localhost:${PORT}/a2a`);
console.log(`   Memory:        http://localhost:${PORT}/memory\n`);

console.log("Discovering sub-agents…");
const [cc, rc] = await Promise.allSettled([
  fetchAgentCard(CODER_URL),
  fetchAgentCard(RESEARCHER_URL),
]);
if (cc.status === "fulfilled" && cc.value)
  console.log(`   ✓ ${cc.value.name} @ ${cc.value.url}`);
else console.log(`   ✗ Coder Agent not reachable (start it first)`);
if (rc.status === "fulfilled" && rc.value)
  console.log(`   ✓ ${rc.value.name} @ ${rc.value.url}`);
else console.log(`   ✗ Researcher Agent not reachable (start it first)`);
