/**
 * Coder Agent — A2A specialist
 * Port: 4001
 * Agent Card: GET http://localhost:4001/.well-known/agent-card.json
 *
 * Receives coding tasks via A2A (message/send), executes them,
 * and streams results back. Uses the MCP tool server internally.
 *
 * Start: bun agents/coder-agent.ts
 */

import type { AgentCard, A2AMessage, A2APart } from "./types.ts";

const PORT = 4001;
const AGENT_CARD: AgentCard = {
  name: "Coder Agent",
  description:
    "Writes, reviews, and runs code. Delegates Python execution to MCP uv-tools.",
  url: `http://localhost:${PORT}`,
  version: "1.0.0",
  capabilities: { streaming: true, pushNotifications: false },
  skills: [
    {
      id: "write-code",
      name: "Write code",
      description: "Generates code from a natural language description",
      inputModes: ["text"],
      outputModes: ["text", "data"],
    },
    {
      id: "run-python",
      name: "Run Python",
      description: "Executes Python snippets via uv subprocess",
      inputModes: ["text"],
      outputModes: ["text"],
    },
    {
      id: "review-code",
      name: "Review code",
      description: "Code review: correctness, style, edge cases",
      inputModes: ["text"],
      outputModes: ["text"],
    },
  ],
};

// ── In-memory task store ──────────────────────────────────────────────────────
const tasks = new Map<
  string,
  { state: string; messages: A2AMessage[]; artifacts: unknown[] }
>();

function mkId() {
  return crypto.randomUUID();
}

// ── Simulated agent logic ─────────────────────────────────────────────────────
async function executeTask(
  userText: string,
): Promise<{ text: string; artifact?: unknown }> {
  const lower = userText.toLowerCase();

  if (lower.includes("fibonacci") || lower.includes("fib")) {
    return {
      text: "Generated Fibonacci implementation.",
      artifact: {
        name: "fibonacci.ts",
        content: `export function fib(n: number): number {
  if (n <= 1) return n
  let a = 0, b = 1
  for (let i = 2; i <= n; i++) [a, b] = [b, a + b]
  return b
}`,
      },
    };
  }

  if (lower.includes("review")) {
    return {
      text: `Code review complete:
✓ Logic appears correct
✓ Edge cases: check for n < 0
⚠ Consider adding JSDoc
⚠ No tests found — add unit tests`,
    };
  }

  if (lower.includes("python") || lower.includes("uv")) {
    return {
      text: `Python snippet executed via uv:
\`\`\`
result = [x**2 for x in range(10)]
print(result)  # [0, 1, 4, 9, 16, 25, 36, 49, 64, 81]
\`\`\`
Output: [0, 1, 4, 9, 16, 25, 36, 49, 64, 81]`,
    };
  }

  return {
    text: `Coder agent processed: "${userText}"\n\nGenerated skeleton — fill in your domain logic here.`,
  };
}

// ── JSON-RPC dispatcher ───────────────────────────────────────────────────────
async function handleRPC(body: unknown): Promise<unknown> {
  const { jsonrpc, id, method, params } = body as {
    jsonrpc: string;
    id: string | number;
    method: string;
    params: Record<string, unknown>;
  };

  const ok = (result: unknown) => ({ jsonrpc, id, result });
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

    // Kick off async execution
    const task = {
      state: "working",
      messages: [msg],
      artifacts: [] as unknown[],
    };
    tasks.set(taskId, task);

    // Run (async — in real system this would stream SSE)
    setTimeout(async () => {
      const { text: responseText, artifact } = await executeTask(userText);
      task.state = "completed";
      task.messages.push({
        messageId: mkId(),
        role: "agent",
        kind: "message",
        parts: [{ kind: "text", text: responseText }],
        contextId,
        taskId,
      });
      if (artifact) task.artifacts.push(artifact);
    }, 100);

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
      artifacts: task.artifacts,
    });
  }

  if (method === "tasks/cancel") {
    const { taskId } = params as { taskId: string };
    const task = tasks.get(taskId);
    if (task) task.state = "canceled";
    return ok({ canceled: true });
  }

  return err(-32601, `Method not found: ${method}`);
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Agent card discovery (A2A spec: /.well-known/agent-card.json)
    if (url.pathname === "/.well-known/agent-card.json") {
      return Response.json(AGENT_CARD, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // A2A JSON-RPC endpoint
    if (url.pathname === "/a2a" && req.method === "POST") {
      const body = await req.json();
      const result = await handleRPC(body);
      return Response.json(result, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // Health
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        agent: AGENT_CARD.name,
        port: PORT,
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`🤖 Coder Agent  →  http://localhost:${PORT}`);
console.log(
  `   Card:          http://localhost:${PORT}/.well-known/agent-card.json`,
);
console.log(`   A2A endpoint:  http://localhost:${PORT}/a2a`);
