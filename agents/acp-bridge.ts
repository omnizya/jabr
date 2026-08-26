/**
 * ACP Bridge — Agent Client Protocol (stdio nd-JSON)
 *
 * Wraps the A2A orchestrator as an ACP-compatible subprocess.
 * IDEs (Zed, JetBrains, Neovim/avante) spawn this process and
 * talk JSON-RPC over stdin/stdout.
 *
 * Wire in Zed settings.json:
 *   { "command": "bun", "args": ["agents/acp-bridge.ts"] }
 *
 * Wire in JetBrains acp.json:
 *   { "agent-lab": { "command": "bun", "args": ["agents/acp-bridge.ts"] } }
 *
 * ACP flow:
 *   IDE  →  initialize  →  bridge
 *   IDE  →  sessions/create  →  bridge
 *   IDE  →  sessions/message  →  bridge  →  A2A orchestrator
 *   bridge  →  sessions/message (stream)  →  IDE
 */

const ORCHESTRATOR = "http://localhost:4000"; // FIXME: put in envar

// Capabilities advertised to the IDE
export const CAPABILITIES = {
  tools: true,
  streaming: true,
  multimodal: false,
};

// Active sessions: sessionId → contextId
export const sessions = new Map<string, string>();
export type DispatchRequest = {
  jsonrcp: string;
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
};
const DISPATCH_STATS = {
  INIT: "initialize",
  LIFE_CYCLE: {
    CREATE: "sessions/create",
    CLOSE: "sessions/close",
    MESSAGE: "sessions/message",
  },
  CAPABILITIES: "capabilities",
};
// ── ACP JSON-RPC dispatcher ───────────────────────────────────────────────────
async function dispatch(req: DispatchRequest): Promise<unknown> {
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
  const err = (code: number, message: string) => ({
    jsonrpc: "2.0",
    id: req.id,
    error: { code, message },
  });

  switch (req.method) {
    // ── ACP handshake ────────────────────────────────────────────────────────
    // TODO: meta from package.json
    case DISPATCH_STATS.INIT: {
      return ok({
        agentName: "agent-lab",
        version: "1.0.0",
        description: "Hermes-style orchestrator via ACP bridge → A2A",
        capabilities: CAPABILITIES,
      });
    }

    // ── Session lifecycle ────────────────────────────────────────────────────
    case DISPATCH_STATS.LIFE_CYCLE.CREATE: {
      const sessionId = crypto.randomUUID();
      sessions.set(sessionId, crypto.randomUUID());
      return ok({ sessionId, status: "created" });
    }

    case DISPATCH_STATS.LIFE_CYCLE.CLOSE: {
      const { sessionId } = (req.params ?? {}) as { sessionId: string };
      sessions.delete(sessionId);
      return ok({ status: "closed" });
    }

    // ── Message — delegate to A2A orchestrator ───────────────────────────────
    case DISPATCH_STATS.LIFE_CYCLE.MESSAGE: {
      const { sessionId, message } = (req.params ?? {}) as {
        sessionId: string;
        message: { role: string; content: string };
      };

      if (!sessions.has(sessionId)) return err(-32001, "Unknown session");

      // Forward to orchestrator via A2A
      let taskId: string;
      try {
        const msgId = crypto.randomUUID();
        const res = await fetch(`${ORCHESTRATOR}/a2a`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: msgId,
            method: "message/send",
            params: {
              message: {
                messageId: msgId,
                role: "user",
                kind: "message",
                parts: [{ kind: "text", text: message.content }],
                contextId: sessions.get(sessionId),
              },
            },
          }),
        });
        const { result } = (await res.json()) as { result: { id: string } };
        taskId = result.id;
      } catch (e) {
        // Orchestrator not running — return helpful message
        return ok({
          role: "assistant",
          content: `[ACP Bridge] Could not reach orchestrator at ${ORCHESTRATOR}.\nStart it with: bun agents/orchestrator.ts\n\nEcho: ${message.content}`,
          status: "completed",
        });
      }

      // Poll for result
      for (let i = 0; i < 30; i++) {
        await Bun.sleep(300);
        try {
          const poll = await fetch(`${ORCHESTRATOR}/a2a`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: crypto.randomUUID(),
              method: "tasks/get",
              params: { taskId },
            }),
          });
          const { result: polled } = (await poll.json()) as {
            result: {
              status: { state: string };
              history: Array<{
                role: string;
                parts: Array<{ kind: string; text: string }>;
              }>;
            };
          };
          if (polled.status.state === "completed") {
            const agentMsg = polled.history.find((m) => m.role === "agent");
            return ok({
              role: "assistant",
              content:
                agentMsg?.parts.find((p) => p.kind === "text")?.text ??
                "(empty)",
              status: "completed",
            });
          }
          if (polled.status.state === "failed")
            return err(-32000, "Agent task failed");
        } catch {
          // continue polling
        }
      }

      return err(-32000, "Timeout waiting for orchestrator response");
    }

    // ── Capability query ──────────────────────────────────────────────────────
    case DISPATCH_STATS.CAPABILITIES: {
      return ok(CAPABILITIES);
    }

    default:
      return err(-32601, `Method not found: ${req.method}`);
  }
}

// ── stdio nd-JSON loop (one JSON object per line) ────────────────────────────
process.stdin.setEncoding("utf-8");
let buffer = "";

process.stdin.on("data", async (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const req = JSON.parse(trimmed);
      const response = await dispatch(req);
      process.stdout.write(JSON.stringify(response) + "\n");
    } catch (e) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        }) + "\n",
      );
    }
  }
});

process.stderr.write("ACP bridge ready — awaiting IDE connection on stdio\n");

// Notify IDE we're alive (ACP spec: optional init notification)
process.stdout.write(
  JSON.stringify({
    jsonrpc: "2.0",
    method: "agent/ready",
    params: { agent: "agent-lab", version: "1.0.0" },
  }) + "\n",
);
