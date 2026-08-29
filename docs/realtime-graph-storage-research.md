# Jabr Real-time, Graph Mesh & Distributed Storage Research

**Date:** 2026-08-29
**Architecture:** Hexagonal (Ports & Adapters)
**Scope:** Socket.io, GunJS, IPFS, libp2p

---

## Executive Summary

Jabr's current architecture is synchronous HTTP + SQLite. For production multi-agent systems at scale, three additional layers are relevant:

1. **Real-time push** — Socket.io for live dashboards, agent status, task progress
2. **Distributed graph memory** — GunJS for P2P state sync across agent nodes
3. **Content-addressed storage** — IPFS for immutable agent artifacts, logs, cold storage

**Recommendation:** Implement Socket.io first (highest ROI), then IPFS for artifact archival. GunJS is experimental — evaluate after production hardening.

---

## 1. Socket.io / Real-time Communication

### What it is

Socket.io is a JavaScript library for bidirectional, event-driven communication over WebSockets with auto-reconnection and fallback to long-polling.

### Current Jabr Gap

- All A2A communication is synchronous HTTP JSON-RPC
- No live status updates — clients must poll
- Dashboard requires manual refresh
- No push notifications for task completion/failure

### Use Cases

| Use Case | Current | With Socket.io |
|----------|---------|----------------|
| Agent status dashboard | Poll every 5s | Live push |
| Task progress tracking | Poll task state | Stream updates |
| Log streaming | Tail -F on file | Live WebSocket stream |
| Alerting | None | Instant push |
| Multi-user collaboration | None | Presence + cursors |

### Hexagonal Mapping

```
agents/ports/
├── realtime-port.ts         # Realtime event emission contract

agents/adapters/
├── http/
│   └── socket-io-adapter.ts # Socket.io server + client
```

### Port Interface

```typescript
// ports/realtime-port.ts
export interface RealtimePort {
  // Emit event to all connected clients
  broadcast(event: string, payload: unknown): void;
  
  // Emit event to specific room (e.g., task-123)
  emitTo(room: string, event: string, payload: unknown): void;
  
  // Subscribe to events from clients
  on(event: string, handler: (payload: unknown) => void): void;
  
  // Get connected client count
  getConnectionCount(): number;
}
```

### Events Schema

```typescript
// Agent lifecycle
"agent:online"    → { agent: string, port: number }
"agent:offline"   → { agent: string }
"agent:error"     → { agent: string, error: string }

// Task lifecycle
"task:created"    → { taskId: string, agent: string }
"task:progress"   → { taskId: string, percent: number, message: string }
"task:completed"  → { taskId: string, result: unknown }
"task:failed"     → { taskId: string, error: string }

// System
"system:health"   → { agents: number, tasks: number, memory: number }
"system:alert"    → { level: "info" | "warning" | "error", message: string }
```

### Implementation Notes

- **Bun native:** Bun has built-in WebSocket support (no Socket.io dependency needed)
- **Rooms:** Use task IDs as room names for targeted updates
- **Reconnection:** Built-in, with exponential backoff
- **Scaling:** Redis adapter for multi-server (future)

---

## 2. GunJS — Decentralized Graph Database

### What it is

GunJS is a real-time, decentralized, offline-first graph data synchronization engine. Data is stored as nodes in a graph, synced P2P across peers.

### Current Jabr Gap

- SQLite is centralized — single point of failure
- No multi-node synchronization
- No offline capability
- No conflict resolution for concurrent writes

### Use Cases

| Use Case | SQLite | GunJS |
|----------|--------|-------|
| Single-node persistence | ✅ | ✅ |
| Multi-node sync | ❌ | ✅ |
| Offline-first | ❌ | ✅ |
| P2P agent communication | ❌ | ✅ |
| Conflict resolution | Manual | Built-in CRDT |
| Graph queries | Manual traversal | Native graph |

### Hexagonal Mapping

```
agents/ports/
├── graph-memory-port.ts     # Graph memory contract

agents/adapters/
├── gunjs/
│   └── gunjs-memory-adapter.ts
```

### Port Interface

```typescript
// ports/graph-memory-port.ts
export interface GraphMemoryPort {
  // Set a node in the graph
  set(key: string, value: unknown): Promise<void>;
  
  // Get a node from the graph
  get(key: string): Promise<unknown>;
  
  // Subscribe to changes on a key
  subscribe(key: string, callback: (value: unknown) => void): () => void;
  
  // Query graph by path
  query(path: string[]): Promise<unknown[]>;
  
  // Get graph stats
  getStats(): { nodes: number; edges: number; peers: number };
}
```

### GunJS Data Model

```typescript
// Example: Agent state in GunJS
const gun = await Gun({ peers: ["http://localhost:8765/gun"] });

// Set agent status
gun.get("agents").get("oracle").get("status").put("online");

// Subscribe to changes
gun.get("agents").get("oracle").get("status").on((status) => {
  console.log("Oracle status:", status);
});

// Graph traversal
gun.get("agents").map().on((data, key) => {
  console.log(`Agent ${key}:`, data);
});
```

### Implementation Notes

- **CRDT-based:** Conflict-free replicated data types for concurrent writes
- **Offline-first:** Works without network, syncs on reconnect
- **Encryption:** SEA (Security, Encryption, Authorization) for E2E encryption
- **Storage adapters:** localStorage, SQLite, S3, IPFS
- **Limitations:** Not suitable for high-write-throughput (>1000 writes/sec)

---

## 3. IPFS — InterPlanetary File System

### What it is

IPFS is a peer-to-peer hypermedia protocol for distributed file storage. Files are content-addressed (CID), deduplicated, and distributed across nodes.

### Current Jabr Gap

- No artifact storage (logs, outputs, media)
- No content addressing (can't verify integrity)
- No distributed sharing (single-node only)
- No immutability guarantee

### Use Cases

| Use Case | Local FS | IPFS |
|----------|----------|------|
| Agent artifact storage | ✅ | ✅ |
| Content integrity verification | ❌ | ✅ (CID) |
| Deduplication | ❌ | ✅ |
| Cross-agent sharing | Manual | CID reference |
| Immutable audit logs | ❌ | ✅ |
| Large file distribution | ❌ | ✅ |

### Hexagonal Mapping

```
agents/ports/
├── artifact-port.ts         # Artifact storage contract

agents/adapters/
├── ipfs/
│   └── ipfs-artifact-adapter.ts
```

### Port Interface

```typescript
// ports/artifact-port.ts
export interface ArtifactPort {
  // Store artifact, returns CID
  store(data: Buffer | string, options?: { pin?: boolean; name?: string }): Promise<string>;
  
  // Retrieve artifact by CID
  retrieve(cid: string): Promise<Buffer>;
  
  // Check if artifact exists
  exists(cid: string): Promise<boolean>;
  
  // Pin artifact (ensure persistence)
  pin(cid: string): Promise<void>;
  
  // Unpin artifact (allow GC)
  unpin(cid: string): Promise<void>;
  
  // Get artifact metadata
  getMetadata(cid: string): Promise<{ size: number; name: string; createdAt: Date }>;
}
```

### IPFS + MCP Integration

The IPFS MCP Toolkit provides MCP tools for IPFS operations:
- `ipfs_add` — Upload file to IPFS
- `ipfs_cat` — Retrieve file from IPFS
- `ipfs_pin` — Pin CID for persistence
- `ipfs_unpin` — Unpin CID

This means Jabr agents can use IPFS via MCP without custom adapter code.

### Implementation Notes

- **Persistence:** IPFS doesn't guarantee persistence — must pin (Pinata, Infura, or self-hosted)
- **Latency:** High for small files, better for large files
- **Gateways:** Use Infura or Pinata for reliable access
- **Cost:** Free for unpinned, ~$0.05/GB/month pinned via Pinata
- **Alternatives:** Filecoin (permanent), Arweave (one-time payment), Storj (S3-compatible)

---

## 4. libp2p — Modular P2P Networking

### What it is

libp2p is a modular peer-to-peer networking stack used by IPFS. Provides transport abstraction, peer discovery, and secure communication.

### Current Jabr Gap

- No peer-to-peer agent communication
- All communication goes through central orchestrator
- No direct agent-to-agent channels

### Use Cases

| Use Case | HTTP | libp2p |
|----------|------|--------|
| Agent-to-agent direct | Via orchestrator | Direct P2P |
| NAT traversal | ❌ | ✅ |
| Peer discovery | Manual | mDNS, DHT |
| Encrypted channels | TLS | Noise protocol |
| Multi-transport | HTTP only | TCP, QUIC, WebSocket, WebRTC |

### When to Use

- Multi-datacenter agent deployment
- Edge agents with intermittent connectivity
- Agent swarms that self-organize

---

## 5. Torrent / BitTorrent

### Relevance to Jabr

**Low relevance.** BitTorrent is optimized for large file distribution, not real-time state. IPFS supersedes it for Jabr's use cases.

**Potential use:** Distributing large model weights or datasets across agent nodes.

---

## Recommendations

### Priority 1: Socket.io (1-2 days)

**Why:** Highest ROI — enables real-time dashboards, live monitoring, instant alerts.

**Implementation:**
- Add `RealtimePort` interface
- Implement `BunWebSocketAdapter` (Bun has native WebSocket, no Socket.io dependency)
- Emit events for agent lifecycle, task lifecycle, system health
- Add WebSocket endpoint to existing A2A server

### Priority 2: IPFS Artifact Storage (2-3 days)

**Why:** Immutable audit logs, artifact deduplication, content integrity.

**Implementation:**
- Add `ArtifactPort` interface
- Implement `IpfsArtifactAdapter` (use ipfs-http-client)
- Store agent outputs, logs, media on IPFS
- Reference artifacts by CID in task records

### Priority 3: GunJS Graph Memory (3-5 days, experimental)

**Why:** Multi-node sync, offline-first, CRDT conflict resolution.

**Implementation:**
- Add `GraphMemoryPort` interface
- Implement `GunJsMemoryAdapter`
- Use for agent state, task queue, memory log
- Evaluate performance vs SQLite

### Priority 4: libp2p Transport (research)

**Why:** Direct agent-to-agent communication, NAT traversal.

**Implementation:**
- Research phase only — no immediate implementation
- Evaluate when multi-datacenter deployment is needed

---

## Hexagonal Architecture Summary

### New Ports

```
agents/ports/
├── realtime-port.ts         # Real-time event emission
├── artifact-port.ts         # Artifact storage (IPFS)
└── graph-memory-port.ts     # Graph memory (GunJS)
```

### New Adapters

```
agents/adapters/
├── http/
│   └── bun-websocket-adapter.ts
├── ipfs/
│   └── ipfs-artifact-adapter.ts
└── gunjs/
    └── gunjs-memory-adapter.ts
```

### New Run Modules

```
agents/run/
├── websocket-server.ts      # Standalone WebSocket server
└── ipfs-daemon.ts          # IPFS node manager
```

---

## TDD Test Plan

### Unit Tests

```typescript
// tests/ports/realtime-port.test.ts
describe("RealtimePort.broadcast", () => {
  test("emits event to all subscribers");
  test("serializes payload as JSON");
});

// tests/adapters/bun-websocket-adapter.test.ts
describe("BunWebSocketAdapter", () => {
  test("accepts WebSocket connections");
  test("broadcasts events to all clients");
  test("emits to specific room");
  test("handles client disconnect");
  test("auto-reconnects on connection loss");
});

// tests/adapters/ipfs-artifact-adapter.test.ts
describe("IpfsArtifactAdapter", () => {
  test("stores artifact and returns CID");
  test("retrieves artifact by CID");
  test("pins artifact for persistence");
  test("verifies content integrity via CID");
});

// tests/adapters/gunjs-memory-adapter.test.ts
describe("GunJsMemoryAdapter", () => {
  test("sets and gets values");
  test("subscribes to changes");
  test("syncs across peers");
  test("resolves conflicts via CRDT");
});
```

### Integration Tests

```typescript
// tests/e2e-realtime.test.ts
describe("Real-time E2E", () => {
  test("agent online → WebSocket event received");
  test("task progress → live updates streamed");
  test("dashboard shows live agent status");
});

// tests/e2e-ipfs.test.ts
describe("IPFS E2E", () => {
  test("store artifact → retrieve by CID");
  test("pin artifact → persists after GC");
  test("deduplication → same CID for same content");
});
```

---

## Research Sources

- [Socket.io Documentation](https://socket.io)
- [GunJS Documentation](https://gun.js.org/)
- [IPFS Documentation](https://docs.ipfs.tech/)
- [IPFS MCP Toolkit](https://github.com/IPFS-Meshkit/py-ipfs-lite)
- [libp2p Documentation](https://docs.libp2p.io/)
- [Decentralized AI Agent Storage (Fastio)](https://fast.io/resources/decentralized-ai-agent-storage/)
- [Agent Registry Survey (arXiv)](https://arxiv.org/abs/2508.03095)
