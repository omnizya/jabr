import type { RealtimePort, RealtimeEvent } from "@ports/realtime-port";
import { buildCorsHeaders, buildCorsPreflightHeaders } from "@utils/rpc";

export interface BunWebSocketAdapterConfig {
  /** Port to listen on. */
  port: number;

  /**
   * CORS allowlist for the HTTP side (upgrade preflight + /health + root).
   * When empty, defaults to localhost origins (mirrors
   * `buildCorsHeaders` / `buildCorsPreflightHeaders` behaviour).
   */
  allowedOrigins?: string[];

  /**
   * Optional ping interval in ms. When set, a ping is sent to each connected
   * client on this interval to detect dead connections and keep proxies from
   * dropping idle TCP connections (helps clients whose auto-reconnect depends
   * on ping/pong). Default: no pings (clients reconnect on their own).
   */
  pingIntervalMs?: number;
}

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:8080",
  "http://localhost:4000",
  "http://localhost:4001",
  "http://localhost:4002",
  "http://localhost:4003",
  "http://localhost:4004",
  "http://localhost:4005",
  "http://localhost:4006",
  "http://localhost:1337",
];

function isValidRealtimeEvent(event: unknown): event is RealtimeEvent {
  if (!event || typeof event !== "object") return false;
  const e = event as Record<string, unknown>;
  if (typeof e.type !== "string") return false;
  switch (e.type) {
    case "agent:online":
      return typeof e.agent === "string" && typeof e.port === "number";
    case "agent:offline":
      return typeof e.agent === "string";
    case "agent:error":
      return typeof e.agent === "string" && typeof e.error === "string";
    case "task:created":
      return typeof e.taskId === "string" && typeof e.agent === "string";
    case "task:progress":
      return (
        typeof e.taskId === "string" &&
        typeof e.percent === "number" &&
        typeof e.message === "string"
      );
    case "task:completed":
      return typeof e.taskId === "string";
    case "task:failed":
      return typeof e.taskId === "string" && typeof e.error === "string";
    case "system:health":
      return Array.isArray(e.agents) && Array.isArray(e.tasks) && Array.isArray(e.memory);
    case "system:alert":
      return (
        e.level === "info" || e.level === "warning" || e.level === "error"
      ) && typeof e.message === "string";
    default:
      return false;
  }
}

/**
 * Native Bun WebSocket server implementing {@link RealtimePort}.
 *
 * Architecture mirrors `WebhookServer` (`agents/adapters/http/webhook-server.ts`):
 * a single `Bun.serve` handler whose `websocket` callbacks manage all
 * connections, with rooms (`Map<string, Set<ServerWebSocket>>`) for
 * task-scoped broadcasts and an event-subscription registry
 * (`Map<eventType, Set<handler>>`) for the `on()` port method.
 *
 * Auto-reconnect is handled by the WebSocket protocol itself — clients that drop
 * and reconnect simply open a fresh connection and (optionally) re-join their room
 * via a client-message handshake (see `JoinRoomMessage` below). The server does not
 * track client identity across reconnects; it treats each connection as fresh.
 */
export class BunWebSocketAdapter implements RealtimePort {
  private readonly port: number;
  private readonly allowedOrigins: string[];
  private readonly pingIntervalMs: number | undefined;

  private server: ReturnType<typeof Bun.serve> | null = null;

  /** room name → connections in that room. */
  private rooms = new Map<string, Set<WebSocket>>();

  /** event type → ordered set of handlers. */
  private handlers = new Map<
    RealtimeEvent["type"],
    Set<(payload: RealtimeEvent) => void>
  >();

  /** All live WebSocket connections (for getConnectionCount + ping). */
  private allConnections = new Set<WebSocket>();

  /** `wss://localhost:<port>` — exposed for clients that need the URL. */
  get url(): string {
    return `wss://localhost:${this.port}`;
  }

  constructor(config: BunWebSocketAdapterConfig) {
    this.port = config.port;
    this.allowedOrigins =
      config.allowedOrigins && config.allowedOrigins.length > 0
        ? config.allowedOrigins
        : DEFAULT_ALLOWED_ORIGINS;
    this.pingIntervalMs = config.pingIntervalMs;
  }

  // ---- lifecycle ----

  start(): void {
    if (this.server) return;
    const self = this;

    this.server = Bun.serve({
      port: this.port,
      // Bun.serve WebSocket upgrade is triggered by the `websocket` key.
      // The `fetch` handler still runs for non-WebSocket HTTP requests (health
      // check, CORS preflight on the HTTP side, root info, and the POST /emit
      // endpoint used by agent runners to broadcast lifecycle events).
      async fetch(req, server) {
        const url = new URL(req.url);

        // WebSocket upgrade: use server.upgrade() then return undefined.
        // Bun sends a 101 Switching Protocols and invokes the websocket callbacks.
        if (
          req.method === "GET" &&
          (req.headers.get("Upgrade") ?? "").toLowerCase() === "websocket"
        ) {
          server.upgrade(req, { data: undefined });
          return undefined;
        }

        if (req.method === "OPTIONS") {
          const origin = req.headers.get("Origin");
          const headers = buildCorsPreflightHeaders(origin);
          if (!headers) return new Response(null, { status: 204 });
          return new Response(null, { headers });
        }

        // POST /emit — broadcast a realtime event to all connected clients.
        if (req.method === "POST" && url.pathname === "/emit") {
          return await BunWebSocketAdapter.handleEmit(req, self);
        }

        if (url.pathname === "/health") {
          return Response.json({
            status: "ok",
            ws: self.url,
            connections: self.getConnectionCount(),
          });
        }
        const headers = buildCorsHeaders(url.origin);
        return new Response(
          "Jabr WebSocket server — connect to " + self.url, {
            status: 200,
            headers: headers ?? { "Content-Type": "text/plain" },
          },
        );
      },
      websocket: {
        open(ws) {
          self.onOpen(ws as unknown as WebSocket);
        },
        // Called when a message arrives from the client.
        message(ws, msg) {
          self.onMessage(ws as unknown as WebSocket, msg);
        },
        // Called when the connection closes (client disconnect, network drop,
        // or server-side close). Auto-reconnect is the client's job — here we
        // just clean up the rooms + global set.
        close(ws, code, reason) {
          self.onClose(ws as unknown as WebSocket, code, reason);
        },
      },
    });

    if (this.pingIntervalMs && this.pingIntervalMs > 0) {
      setInterval(() => self.pingAll(), this.pingIntervalMs);
    }

    console.log(`\n🟢 BunWebSocketAdapter → ${self.url}`);
    console.log(
      `   CORS origins: ${self
        .allowedOrigins.length > 0
        ? self.allowedOrigins.join(", ")
        : "default localhost set"}`,
    );
    if (self.pingIntervalMs && self.pingIntervalMs > 0) {
      console.log(`   Ping interval: ${self.pingIntervalMs}ms`);
    }
    console.log(
      `   Health:   ${self.url.replace("wss://", "http://").replace("/websocket", "")}/health`,
    );
    console.log(`   Emit:    POST ${self.url.replace("wss://", "http://")}/emit\n`);
  }

  stop(): void {
    this.server?.stop();
    this.server = null;
    this.rooms.clear();
    this.allConnections.clear();
    // Keep handlers — they're stateless closures; no need to clear.
    console.log(`[BunWebSocketAdapter] stopped`);
  }

  // ---- RealtimePort ----

  broadcast(event: RealtimeEvent): void {
    // Fire subscribers registered via the port's on() method.
    const handlerSet = this.handlers.get(event.type);
    if (handlerSet) {
      for (const handler of handlerSet) handler(event);
    }
    // Send to every connected client, regardless of room.
    this.sendToAll(JSON.stringify(event));
  }

  emitTo(room: string, event: RealtimeEvent): void {
    const roomSet = this.rooms.get(room);
    if (!roomSet || roomSet.size === 0) return;
    const payload = JSON.stringify(event);
    for (const ws of roomSet) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  on(
    eventType: RealtimeEvent["type"],
    handler: (payload: RealtimeEvent) => void,
  ): void {
    let set = this.handlers.get(eventType);
    if (!set) {
      set = new Set();
      this.handlers.set(eventType, set);
    }
    set.add(handler);
  }

  getConnectionCount(): number {
    return this.allConnections.size;
  }

  // ---- internal ----

  private onOpen(ws: WebSocket): void {
    this.allConnections.add(ws);
    console.log(
      `[BunWebSocketAdapter] open  → ${this.getConnectionCount()} connection(s)`,
    );
  }

  private onMessage(ws: WebSocket, msg: unknown): void {
    if (typeof msg !== "string") return;
    try {
      const parsed =
        JSON.parse(msg) as { type?: unknown; room?: unknown } | undefined;
      if (parsed && typeof parsed.type === "string" && parsed.type === "join-room" && typeof parsed.room === "string") {
        this.joinRoom(ws, parsed.room as string);
        return;
      }
    } catch {
      // Not JSON — ignore.
    }
    console.warn(`[BunWebSocketAdapter] unrecognised client message: ${msg}`);
  }

  /**
   * Async handler for POST /emit. Extracted so the `fetch` handler can stay
   * synchronous (returning `undefined` for WebSocket upgrades is only valid
   * from a non-async function in Bun 1.x).
   */
  private static async handleEmit(
    req: Request,
    self: BunWebSocketAdapter,
  ): Promise<Response> {
    let raw: string;
    try {
      raw = await req.text();
    } catch {
      return new Response(
        JSON.stringify({ error: { code: -32700, message: "Parse error" } }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    let event: RealtimeEvent;
    try {
      event = JSON.parse(raw);
    } catch {
      return new Response(
        JSON.stringify({ error: { code: -32600, message: "Invalid JSON" } }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (!isValidRealtimeEvent(event)) {
      return new Response(
        JSON.stringify({
          error: { code: -32602, message: "Unknown event type" },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    self.broadcast(event);
    const origin = req.headers.get("Origin");
    const headers = buildCorsHeaders(origin) ?? {
      "Content-Type": "application/json",
    };
    return Response.json({ ok: true }, { headers });
  }

  private onClose(ws: WebSocket, _code: number, _reason: string): void {
    this.allConnections.delete(ws);
    // Remove from every room the connection joined.
    for (const [, roomSet] of this.rooms) {
      roomSet.delete(ws);
    }
    console.log(
      `[BunWebSocketAdapter] close → ${this.getConnectionCount()} connection(s)`,
    );
  }

  /**
   * Add `ws` to `room`. Re-joining an already-joined room is a no-op (Set
   * semantics). Clients send `{ "type": "join-room", "room": "task-<id>" }`
   * after connecting; the adapter also exposes `joinRoom(ws, room)` publicly so
   * server-side code can place a connection into a room without a client message.
   */
  joinRoom(ws: WebSocket, room: string): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    let set = this.rooms.get(room);
    if (!set) {
      set = new Set();
      this.rooms.set(room, set);
    }
    set.add(ws);
    console.log(
      `[BunWebSocketAdapter] join  → ${room} (${set.size} member(s))`,
    );
  }

  /**
   * Remove `ws` from `room`. No-op if the connection wasn't in the room.
   */
  leaveRoom(ws: WebSocket, room: string): void {
    const set = this.rooms.get(room);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.rooms.delete(room);
    console.log(`[BunWebSocketAdapter] leave → ${room}`);
  }

  private sendToAll(payload: string): void {
    const dead: WebSocket[] = [];
    for (const ws of this.allConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
        } catch (e) {
          dead.push(ws);
        }
      } else {
        dead.push(ws);
      }
    }
    for (const ws of dead) {
      this.allConnections.delete(ws);
      for (const [, roomSet] of this.rooms) roomSet.delete(ws);
    }
    if (dead.length > 0) {
      console.log(
        `[BunWebSocketAdapter] cleaned up ${dead.length} dead connection(s)`,
      );
    }
  }

  private pingAll(): void {
    const dead: WebSocket[] = [];
    for (const ws of this.allConnections) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      } catch (e) {
        dead.push(ws);
      }
    }
    for (const ws of dead) {
      this.allConnections.delete(ws);
      for (const [, roomSet] of this.rooms) roomSet.delete(ws);
    }
    if (dead.length > 0) {
      console.log(
        `[BunWebSocketAdapter] ping cleanup: ${dead.length} dead connection(s)`,
      );
    }
  }
}

/**
 * Client-facing message shape for the room-join handshake. After opening a
 * WebSocket to the adapter, a client that wants task-scoped updates sends:
 *
 *   JSON.stringify({ type: "join-room", room: `task-${taskId}` })
 *
 * The adapter acknowledges by placing the connection into that room; subsequent
 * `adapter.emitTo(`task-${taskId}`, event)` calls will reach it.
 */
export interface JoinRoomMessage {
  type: "join-room";
  room: string;
}

/**
 * Start a BunWebSocketAdapter from env + config, mirroring how the other
 * adapters are started in `agents/run/*.ts`.
 */
export function startBunWebSocketAdapter(
  config: BunWebSocketAdapterConfig,
): BunWebSocketAdapter {
  const adapter = new BunWebSocketAdapter(config);
  adapter.start();
  return adapter;
}
