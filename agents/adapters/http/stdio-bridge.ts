import {
  type JSONRPCRequest,
  type JSONRPCResponse,
  type JSONRPCNotification,
  ok,
  err,
  notification,
} from "@utils/rpc";
import type {
  MemoryStorePort,
  SessionData,
  SessionEntry,
} from "@ports/memory-store";
import {
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { dirname } from "node:path";

interface DiffContent {
  path?: string;
  oldText?: string;
  newText?: string;
  unified?: string;
}

export class StdioBridge {
  private readonly orchestratorUrl: string;
  private readonly memory: MemoryStorePort;
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private onData: ((chunk: Uint8Array) => void) | null = null;
  private currentSessionId: string | null = null;

  constructor(
    config: { orchestratorUrl?: string; memory?: MemoryStorePort } = {},
  ) {
    this.orchestratorUrl = config.orchestratorUrl ?? "http://localhost:4000";
    if (config.memory) {
      this.memory = config.memory;
    } else {
      const sessions = new Map<string, SessionData>();
      let markdown = "";
      this.memory = {
        read: () => markdown,
        append: (entry: string) => { markdown += entry + "\n"; },
        listSessions: () => [...sessions.keys()],
        deleteSession: (id: string) => sessions.delete(id),
        getSession: (id: string) => sessions.get(id) ?? null,
        saveSession: (id: string, data: SessionData) => { sessions.set(id, data); },
      };
    }
  }

  start(): void {
    this.onData = (chunk: Uint8Array) => {
      this.buffer += this.decoder.decode(chunk, { stream: true });
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        console.error(`[StdioBridge] ← inbound line: ${trimmed.slice(0, 200)}`);
        this.handleLine(trimmed);
      }
    };
    process.stdin.on("data", this.onData);
  }

  stop(): void {
    if (this.onData) {
      process.stdin.off("data", this.onData);
      this.onData = null;
    }
  }

  notifyToolCallUpdate(
    toolCallId: string,
    status: string,
    content?: unknown,
  ): void {
    const params: Record<string, unknown> = { toolCallId, status };
    if (content !== undefined) params.content = content;
    const note: JSONRPCNotification = notification("tool_call_update", params);
    console.error(
      `[StdioBridge] → notify tool_call_update toolCallId=${toolCallId} status=${status}`,
    );
    process.stdout.write(JSON.stringify(note) + "\n");
  }

  private async handleLine(line: string): Promise<void> {
    let req: JSONRPCRequest;
    try {
      req = JSON.parse(line) as JSONRPCRequest;
    } catch {
      console.error("[StdioBridge] parse error: invalid JSON-RPC line");
      process.stdout.write(
        JSON.stringify(err(null, -32700, "Parse error")) + "\n",
      );
      return;
    }

    console.error(
      `[StdioBridge] ← ${req.method ?? "<unknown>"} id=${req.id ?? "null"}`,
    );

    const response = await this.dispatch(req);
    console.error(
      `[StdioBridge] → response id=${response.id ?? "null"} ` +
        `${response.error ? `error=${response.error.code} ${response.error.message}` : "ok"}`,
    );
    process.stdout.write(JSON.stringify(response) + "\n");
  }

  private async dispatch(req: JSONRPCRequest): Promise<JSONRPCResponse> {
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
      return err(req.id ?? null, -32600, "Invalid Request");
    }

    switch (req.method) {
      case "initialize": {
        console.error("[StdioBridge] dispatch: initialize");
        return ok(req.id, { capabilities: {} });
      }

      case "message": {
        const params = (req.params ?? {}) as {
          content?: { type?: string; text?: string } & DiffContent;
          sessionId?: string;
        };
        const content = params.content;
        if (!content) {
          return err(req.id, -32602, "Invalid params: missing content");
        }

        if (content.type === "diff") {
          return await this.handleDiff(req, content);
        }

        const text = content.text;
        if (typeof text !== "string") {
          return err(req.id, -32602, "Invalid params: missing content.text");
        }
        return await this.handleMessage(req, text, params.sessionId);
      }

      case "session/list": {
        console.error("[StdioBridge] dispatch: session/list");
        return ok(req.id, { sessions: this.memory.listSessions() });
      }

      case "session/delete": {
        const params = (req.params ?? {}) as { sessionId?: string };
        if (typeof params.sessionId !== "string") {
          return err(req.id, -32602, "Invalid params: missing sessionId");
        }
        console.error(`[StdioBridge] dispatch: session/delete ${params.sessionId}`);
        const deleted = this.memory.deleteSession(params.sessionId);
        if (this.currentSessionId === params.sessionId) {
          this.currentSessionId = null;
        }
        return ok(req.id, { deleted });
      }

      case "session/resume": {
        const params = (req.params ?? {}) as {
          sessionId?: string;
          replayFrom?: { type: string };
        };
        if (typeof params.sessionId !== "string") {
          return err(req.id, -32602, "Invalid params: missing sessionId");
        }
        console.error(`[StdioBridge] dispatch: session/resume ${params.sessionId}`);
        const session = this.memory.getSession(params.sessionId);
        if (!session) {
          return err(req.id, -32602, `Session not found: ${params.sessionId}`);
        }
        this.currentSessionId = params.sessionId;
        const history =
          params.replayFrom?.type === "start"
            ? session.history
            : session.history.slice(-1);
        return ok(req.id, {
          sessionId: params.sessionId,
          history,
          resumed: true,
        });
      }

      default:
        console.error(`[StdioBridge] dispatch: unknown method ${req.method}`);
        return err(req.id, -32601, `Method not found: ${req.method}`);
    }
  }

  private async handleMessage(
    req: JSONRPCRequest,
    text: string,
    sessionId?: string,
  ): Promise<JSONRPCResponse> {
    try {
      console.error(
        `[StdioBridge] → orchestrator tasks/send (${this.orchestratorUrl})`,
      );
      const started = Date.now();
      const res = await fetch(`${this.orchestratorUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: req.id ?? crypto.randomUUID(),
          method: "tasks/send",
          params: { message: { parts: [{ kind: "text", text }] } },
        }),
      });
      console.error(
        `[StdioBridge] ← orchestrator responded in ${Date.now() - started}ms status=${res.status}`,
      );

      if (!res.ok) {
        console.error(
          `[StdioBridge] orchestrator returned ${res.status} for tasks/send`,
        );
        return err(req.id, -32603, `Orchestrator returned ${res.status}`);
      }

      const body = (await res.json()) as JSONRPCResponse;
      if (body.error) {
        return err(req.id, body.error.code, body.error.message);
      }

      const result = body.result ?? {};
      this.recordMessage(sessionId, "user", { text });
      this.recordMessage(this.currentSessionId ?? undefined, "agent", result);

      const base =
        typeof result === "object" && result !== null
          ? (result as Record<string, unknown>)
          : {};
      return ok(req.id, { ...base, sessionId: this.currentSessionId });
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Unknown fetch error";
      console.error(
        `[StdioBridge] tasks/send failed: ${message}`,
        e instanceof Error ? e.stack : e,
      );
      return err(
        req.id,
        -32603,
        `Internal error: could not reach orchestrator at ${this.orchestratorUrl} (${message})`,
      );
    }
  }

  private async handleDiff(
    req: JSONRPCRequest,
    content: DiffContent,
  ): Promise<JSONRPCResponse> {
    const toolCallId = crypto.randomUUID();
    this.notifyToolCallUpdate(toolCallId, "started", {
      kind: "diff",
      path: content.path,
    });

    if (
      typeof content.path === "string" &&
      typeof content.oldText === "string" &&
      typeof content.newText === "string"
    ) {
      const applied = this.applyDiff(
        content.path,
        content.oldText,
        content.newText,
      );
      this.notifyToolCallUpdate(toolCallId, applied ? "completed" : "failed", {
        applied,
        path: content.path,
      });
      return ok(req.id, { applied, path: content.path });
    }

    if (typeof content.unified === "string") {
      try {
        console.error(
          `[StdioBridge] → orchestrator tasks/send (unified diff) (${this.orchestratorUrl})`,
        );
        const started = Date.now();
        const res = await fetch(`${this.orchestratorUrl}/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: req.id ?? crypto.randomUUID(),
            method: "tasks/send",
            params: {
              message: {
                parts: [{ kind: "text", text: `Apply unified diff:\n${content.unified}` }],
              },
            },
          }),
        });
        console.error(
          `[StdioBridge] ← orchestrator responded in ${Date.now() - started}ms status=${res.status}`,
        );
        if (!res.ok) {
          console.error(
            `[StdioBridge] orchestrator returned ${res.status} for unified diff tasks/send`,
          );
          this.notifyToolCallUpdate(toolCallId, "failed", {
            reason: `orchestrator ${res.status}`,
          });
          return err(req.id, -32603, `Orchestrator returned ${res.status}`);
        }
        const body = (await res.json()) as JSONRPCResponse;
        this.notifyToolCallUpdate(toolCallId, "completed", { forwarded: true });
        if (body.error) {
          return err(req.id, body.error.code, body.error.message);
        }
        return ok(req.id, body.result ?? {});
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Unknown fetch error";
        console.error(
          `[StdioBridge] unified diff tasks/send failed: ${message}`,
          e instanceof Error ? e.stack : e,
        );
        this.notifyToolCallUpdate(toolCallId, "failed", { reason: message });
        return err(req.id, -32603, `Internal error: ${message}`);
      }
    }

    this.notifyToolCallUpdate(toolCallId, "failed", {
      reason: "missing path/oldText/newText or unified",
    });
    return err(
      req.id,
      -32602,
      "Invalid diff: require path+oldText+newText or unified",
    );
  }

  private applyDiff(path: string, oldText: string, newText: string): boolean {
    if (!existsSync(path)) return false;
    const current = readFileSync(path, "utf-8");
    if (!current.includes(oldText)) return false;
    const updated = current.replace(oldText, newText);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, updated, "utf-8");
    return true;
  }

  private recordMessage(
    sessionId: string | undefined,
    role: SessionEntry["role"],
    content: unknown,
  ): void {
    const id = sessionId ?? this.currentSessionId ?? crypto.randomUUID();
    const existing = this.memory.getSession(id);
    const now = new Date().toISOString();
    const entry: SessionEntry = { role, content, timestamp: now };
    const data: SessionData = existing ?? {
      id,
      history: [],
      createdAt: now,
      updatedAt: now,
    };
    data.history.push(entry);
    data.updatedAt = now;
    this.memory.saveSession(id, data);
    this.currentSessionId = id;
  }
}


if (import.meta.main) {
  const bridge = new StdioBridge();
  bridge.start();
  process.stderr.write(
    "ACP stdio bridge (http) ready — awaiting IDE connection on stdio\n",
  );
}
