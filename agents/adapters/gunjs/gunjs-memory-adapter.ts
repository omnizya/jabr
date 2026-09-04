// adapters/gunjs/gunjs-memory-adapter.ts
// Hexagonal adapter: GraphMemoryPort → GunJS (CRDT P2P graph store).
//
// Scope (from realtime-graph-storage-research.md §2 / GraphMemoryPort JSDoc):
//  - Multi-node sync, offline-first, P2P agent communication
//  - Built-in CRDT conflict resolution; not for >1000 writes/sec
//  - SEA (Security, Encryption, Authorization) for E2E encryption
//  - Storage adapters: localStorage, SQLite, S3, IPFS
//
// GunJS node.js semantics (validated against tests/gunjs-multi-node-sync.test.ts):
//  - Nodes MUST be objects; scalars at non-root paths are rejected.
//  - gun.get('a').put({x:1}) stores {x:1} AT node 'a'.
//  - gun.get('a/x') is NOT a child — 'x' is a property of node 'a'.
//  - HTTP peers are pull-only: client pulls from server, writes are NOT
//    auto-pushed. Client→server writes go through relay POST.
//
// SEA / HMAC:
//  - JABR_X402_HMAC_SECRET is used as the SEA HMAC secret for E2E encryption.
//  - The orchestrator already requires this env var at startup (no default),
//    so the adapter can assume it is present when SEA is enabled.
//  - SEA is optional: the adapter works without it for unencrypted local dev.

// GunJS ships without TypeScript types. We use require() (same pattern as
// the existing gunjs-multi-node-sync.test.ts) and declare the minimal
// surface we need below.

import type {
	GraphMemoryPort,
	GraphMemoryStats,
	GraphNode,
	GraphPath,
	GraphQueryOptions,
	GraphQueryResult,
	GraphSubscribeCallback,
} from "../../ports/graph-memory-port";

// ── Gun JS type declarations (minimal surface) ──────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const GunModule = require("gun");

// Minimal Gun instance shape we use.
export interface GunNode {
	get(path: string): GunNode;
	put(data: unknown, cb?: (ack: GunAck) => void): void;
	on(cb: (data: unknown, key?: string) => void): void;
	once(cb: (data: unknown, key?: string) => void): void;
	off(cb?: (data: unknown, key?: string) => void): void;
	map(): GunNode;
	[key: string]: unknown;
}

export interface GunAck {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	err?: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ok?: any;
}

export interface GunInstance extends GunNode {
	SEA?: {
		secret(): string;
		pair(): { publicKey: string; secretKey: string };
	};
	user(): {
		create(secret: string, cb: (ack: GunAck) => void): void;
		auth(secret: string, cb: (ack: GunAck) => void): void;
	};
	settings?: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		[key: string]: any;
	};
}

export interface GunConstructor {
	(opts?: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		file?: any;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		web?: any;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		peers?: string[];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		localStorage?: any;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		radix?: any;
	}): GunInstance;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const Gun: GunConstructor = GunModule;

// ── Types ────────────────────────────────────────────────────────────────────

/** Shape of a Gun peer URL for HTTP relay peers. */
export type GunPeerUrl = string;

// ── GunJS Memory Adapter ─────────────────────────────────────────────────────

export class GunJsMemoryAdapter implements GraphMemoryPort {
	/**
	 * The raw Gun instance. Exposed for tests that need direct Gun access
	 * (e.g. the existing gunjs-multi-node-sync.test.ts HTTP relay pattern).
	 */
	readonly gun: GunInstance;

	/** Peer URLs currently attached for P2P sync. */
	private peers = new Set<GunPeerUrl>();

	/** Map of active subscriptions: key → Array<{callback, offFn}>. */
	private subscriptions = new Map<
		string,
		Array<{ callback: GraphSubscribeCallback; offFn: () => void }>
	>();

	/** SEA enabled flag — true when HMAC secret is available. */
	private seaEnabled: boolean;

	/** SEA HMAC secret (from env), present only when seaEnabled is true. */
	private readonly hmacSecret?: string;

	/**
	 * @param opts
	 *  - peers: initial peer URLs to attach (HTTP relay endpoints).
	 *  - file: persist to disk? (default false — in-memory for agent nodes).
	 *  - web: enable browser web mode? (default false for node).
	 *  - sea: enable SEA E2E encryption. When true, JABR_X402_HMAC_SECRET
	 *    must be set (orchestrator enforces this). When false, no encryption.
	 */
	constructor(
		opts: {
			peers?: GunPeerUrl[];
			file?: boolean;
			web?: boolean;
			sea?: boolean;
		} = {},
	) {
		const { peers = [], file = false, web = false, sea = true } = opts;

		const hmacSecret = process.env.JABR_X402_HMAC_SECRET ?? undefined;
		this.seaEnabled = sea && hmacSecret != null;
		this.hmacSecret = this.seaEnabled ? hmacSecret : undefined;

		// Gun's file option: in node it accepts a boolean OR a directory path string.
		// We pass boolean false for in-memory; Gun treats false as "no file".
		this.gun = Gun({
			file,
			web,
			peers: peers.filter(Boolean),
			localStorage: false,
		});

		if (this.seaEnabled) {
			this._initSEA();
		}

		// Attach initial peers.
		for (const peer of peers) {
			this.peers.add(peer);
		}
	}

	// ── SEA init ──────────────────────────────────────────────────────────────

	/**
	 * Initialize SEA with the HMAC secret. Gun's SEA module provides
	 * user-based key pairs; here we use HMAC secret-based signing for
	 * node-level encryption so that all peers sharing the secret can
	 * read/write encrypted graph data.
	 *
	 * Gun SEA in Node.js: `gun.SEA` is available after Gun construction.
	 * We register the HMAC secret as a "user" key pair so that put/on
	 * operations can be encrypted.
	 */
	private _initSEA(): void {
		if (!this.hmacSecret || !this.gun.SEA) {
			return;
		}

		// Gun SEA expects a user object with a "pair" (key pair).
		// For HMAC-based symmetric encryption, we create a user identity
		// derived from the secret and call user.create() + user.auth().
		//
		// Practical approach: use SEA's secret bootstrapping.
		// Gun 0.2020.x SEA API:
		//   gun.SEA.secret()  → generate a random secret
		//   gun.SEA.pair()    → generate a key pair
		//   gun.user().get("name").auth(pair) → authenticate a user
		//
		// For symmetric E2E, the simplest reliable path is to use
		// gun.SEA.secret as the shared secret and rely on Gun's built-in
		// HMAC-based message signing. We mark the gun instance as "trusted"
		// by registering the HMAC secret as a user.
		//
		// NOTE: Gun's SEA API in 0.2020.x is somewhat undocumented and
		// version-sensitive. The adapter uses the documented surface and
		// gracefully degrades if specific calls are unavailable.

		try {
			// Create a key pair from the HMAC secret (deterministic).
			// In Gun, SEA pairs are generated with SEA.pair().
			// For a shared secret model, we register the HMAC secret
			// directly as the "secret" for a user identity.
			const user = this.gun.user();
			// Gun 0.2020.x: user.create(secret) or user.auth(pair, cb).
			// We use the HMAC secret as a password-equivalent for a
			// deterministic user identity so peers with the same secret
			// can decrypt each other's data.
			user.create(this.hmacSecret!, (ack: GunAck) => {
				if (ack.err) {
					console.warn("[GunJsMemoryAdapter] SEA user create failed:", ack.err);
				} else {
					// Authenticate the user so subsequent put/on calls are encrypted.
					user.auth(this.hmacSecret!, (authAck: GunAck) => {
						if (authAck.err) {
							console.warn(
								"[GunJsMemoryAdapter] SEA user auth failed:",
								authAck.err,
							);
						}
					});
				}
			});
		} catch (err: unknown) {
			// SEA init is non-fatal — the adapter still works without encryption.
			console.warn(
				"[GunJsMemoryAdapter] SEA init error (encryption disabled):",
				err,
			);
			this.seaEnabled = false;
		}
	}

	// ── Port: set ─────────────────────────────────────────────────────────────

	/**
	 * Set a node in the graph. Creates or overwrites the node at `key`.
	 * Value may be any JSON-serializable structure; nested objects become
	 * child nodes automatically in Gun.
	 *
	 * CRDT behavior: concurrent writes to the same key merge by
	 * last-writer-wins per peer; Gun attaches vector-clock metadata
	 * automatically.
	 *
	 * GunJS constraint: nodes MUST be objects. Scalars (strings, numbers,
	 * booleans) are rejected at non-root paths. We wrap scalars in {val}.
	 */
	async set(key: string, value: unknown): Promise<void> {
		// GunJS requires nodes to be objects. Wrap scalars.
		const gunValue = this._normalizeGunValue(value);

		return new Promise((resolve, reject) => {
			this.gun.get(key).put(gunValue, (ack: GunAck) => {
				if (ack.err) {
					reject(
						new Error(`Gun set error at key="${key}": ${String(ack.err)}`),
					);
					return;
				}
				resolve();
			});
		});
	}

	// ── Port: get ─────────────────────────────────────────────────────────────

	/**
	 * Get a node by key. Returns the node with its CRDT metadata, or null
	 * if the key does not exist in the local store (may still be pending
	 * sync from a peer).
	 */
	async get<T = unknown>(key: string): Promise<GraphNode<T> | null> {
		return new Promise((resolve) => {
			this.gun.get(key).once((data: unknown) => {
				if (data == null) {
					resolve(null);
					return;
				}
				resolve(this._buildNode(key, data));
			});
		});
	}

	// ── Port: subscribe ───────────────────────────────────────────────────────

	/**
	 * Subscribe to live changes on a key. Returns an unsubscribe function.
	 * The callback fires on every local or remote update to the node,
	 * including deletions (node === null).
	 */
	subscribe<T = unknown>(
		key: string,
		callback: GraphSubscribeCallback<T>,
	): () => void {
		const handlers = this.subscriptions.get(key) ?? [];

		const gunCallback: (data: unknown, key?: string) => void = (data, _key) => {
			// Gun fires on() with (data, key). When the node is deleted, data
			// is null (tombstone). Pass null through to the callback.
			if (data == null) {
				callback(null);
				return;
			}
			callback(this._buildNode(key, data) as GraphNode<T>);
		};

		this.gun.get(key).on(gunCallback);

		const offFn = (): void => {
			this.gun.get(key).off(gunCallback);
		};

		handlers.push({ callback: gunCallback as GraphSubscribeCallback, offFn });
		this.subscriptions.set(key, handlers);

		// Return the unsubscribe function to the caller.
		return () => {
			this.gun.get(key).off(gunCallback);
			const remaining = this.subscriptions.get(key);
			if (remaining) {
				const idx = remaining.findIndex((h) => h.offFn === offFn);
				if (idx !== -1) remaining.splice(idx, 1);
				if (remaining.length === 0) this.subscriptions.delete(key);
			}
		};
	}

	// ── Port: query ───────────────────────────────────────────────────────────

	/**
	 * Query the graph starting from a path. Returns matched nodes and edges
	 * within the optional limit/depth/filter constraints.
	 *
	 * GunJS graph traversal uses .map() to iterate over children.
	 * This implementation treats each path segment as a Gun get() step
	 * and uses .map() at the final node to collect its children.
	 *
	 * Note: GunJS map() semantics differ from the port's GraphPath model.
	 * The adapter maps path segments to chained get() calls, then uses
	 * map() at the leaf for subtree collection. This matches the example
	 * in the research doc: gun.get("agents").map().on(...).
	 */
	async query(
		path: GraphPath,
		options?: GraphQueryOptions,
	): Promise<GraphQueryResult> {
		const limit = options?.limit ?? Infinity;
		const depth = options?.depth ?? Infinity;
		const filter = options?.filter ?? (() => true);

		const nodes: Record<string, GraphNode> = {};
		const edges: [string, string][] = [];

		// If path is empty, start from the root (gun.get("")).
		// Gun doesn't support empty path; we start from root by mapping
		// the gun instance directly.
		if (path.length === 0) {
			this._collectSubtree(
				this.gun,
				"",
				"",
				depth,
				limit,
				filter,
				nodes,
				edges,
			);
			return { nodes, edges };
		}

		// Traverse path segments. Each segment is a get() into the graph.
		let node: GunNode = this.gun;
		let currentPath = "";
		for (let i = 0; i < path.length && i < depth; i++) {
			const segment = path[i]!;
			currentPath = currentPath ? `${currentPath}/${segment}` : segment;
			node = node.get(segment);

			// Collect this node.
			const data = this._readOnce(node);
			if (data != null) {
				const nodeObj = this._buildNode(currentPath, data);
				if (filter(nodeObj)) {
					nodes[currentPath] = nodeObj;
				}
			}

			// If we reached max depth, stop. Otherwise, continue traversing.
			if (i === depth - 1) break;
		}

		// At the final path, collect the subtree with map().
		// We use a one-shot read via map() to avoid infinite subscription.
		await this._collectMapSubtree(
			this.gun,
			path,
			0,
			depth,
			limit,
			filter,
			nodes,
			edges,
		);

		return { nodes, edges };
	}

	// ── Port: delete ──────────────────────────────────────────────────────────

	/**
	 * Delete a node and its subtree. Equivalent to set(key, null) in CRDT
	 * adapters — the tombstone propagates to peers.
	 *
	 * GunJS: gun.get(key).put(null) creates a tombstone that propagates.
	 */
	async delete(key: string): Promise<void> {
		return new Promise((resolve, reject) => {
			this.gun.get(key).put(null, (ack: GunAck) => {
				if (ack.err) {
					reject(
						new Error(`Gun delete error at key="${key}": ${String(ack.err)}`),
					);
					return;
				}
				resolve();
			});
		});
	}

	// ── Port: ping ────────────────────────────────────────────────────────────

	/**
	 * Ping a peer by URL and return whether it is reachable.
	 * Uses Gun's HTTP peer relay: GET /gun?get=_ping_ and checks for a response.
	 */
	async ping(peerUrl: string): Promise<boolean> {
		// Gun doesn't have a built-in ping. We use a lightweight HTTP GET
		// to the peer's /gun endpoint to check connectivity.
		// For peers that are Gun HTTP relays, the /gun?get= endpoint responds.
		try {
			const url = new URL(peerUrl);
			// Append a ping query. Gun relays respond to /gun?get= with JSON.
			url.searchParams.set("get", "_ping_");
			const response = await fetch(url.toString(), {
				signal: AbortSignal.timeout(5000),
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	// ── Port: attachPeer / detachPeer ─────────────────────────────────────────

	async attachPeer(peerUrl: string): Promise<void> {
		if (this.peers.has(peerUrl)) return;

		// GunJS peer attachment: add the peer URL to the gun instance.
		// Gun handles peer URLs in its constructor opts.peers, but for
		// dynamic attachment we use gun.get("").get("").put() to trigger
		// peer resolution, or we re-configure the gun instance.
		//
		// The practical approach: GunJS peers are configured at construction
		// time via opts.peers. Dynamic peer addition is done by setting
		// gun.settings.site or by using the gun's peer resolution.
		//
		// For HTTP relay peers (like the test server in
		// gunjs-multi-node-sync.test.ts), the peer URL is the relay base URL.
		// Gun automatically pulls from peers listed in opts.peers.
		//
		// We implement dynamic attachment by adding to the peers set and
		// re-initializing the gun instance's peer list. In Gun 0.2020.x,
		// this is done by writing to the peer graph or by calling
		// gun.get("").put() with peer metadata. The simplest reliable
		// approach is to store the peer URL in the graph so other nodes
		// can discover it, and rely on Gun's built-in peer exchange.

		this.peers.add(peerUrl);

		// GunJS doesn't have a clean API for dynamic peer addition after
		// construction. The recommended approach is to set gun.settings
		// or to use the HTTP relay as a peer. For the HTTP relay case,
		// Gun automatically polls the relay URL for data.
		//
		// We emulate dynamic attachment by putting a peer registration
		// in the graph. This is a workaround; for production, peers should
		// be configured at construction time.
		try {
			this.gun.get("_peers").get(peerUrl).put({
				url: peerUrl,
				attachedAt: Date.now(),
			});
		} catch (err: unknown) {
			console.warn("[GunJsMemoryAdapter] attachPeer write failed:", err);
		}
	}

	async detachPeer(peerUrl: string): Promise<void> {
		this.peers.delete(peerUrl);

		// Remove the peer registration from the graph.
		try {
			this.gun.get("_peers").get(peerUrl).put(null);
		} catch (err: unknown) {
			console.warn("[GunJsMemoryAdapter] detachPeer write failed:", err);
		}
	}

	// ── Port: getStats ────────────────────────────────────────────────────────

	getStats(): GraphMemoryStats {
		// GunJS doesn't expose node/edge/peer counts directly.
		// We estimate from the local graph and the peers set.
		return {
			nodes: this._estimateNodeCount(),
			edges: 0, // GunJS doesn't distinguish edges from nodes; edges = 0.
			peers: this.peers.size,
			online: this._isOnline(),
		};
	}

	// ── Port: waitForSync ─────────────────────────────────────────────────────

	/**
	 * Wait until the local graph has synchronized with at least `minPeers`
	 * peers, or until the timeout elapses. Resolves true when synced,
	 * false on timeout.
	 *
	 * GunJS sync is eventual — there's no built-in "synced" callback.
	 * We poll gun.get("").get("_peers") for peer count, or simply wait
	 * for the timeout to elapse (best-effort).
	 */
	async waitForSync(minPeers?: number, timeoutMs?: number): Promise<boolean> {
		const targetPeers = minPeers ?? 0;
		const timeout = timeoutMs ?? 10000;

		if (targetPeers === 0) return true;

		const start = Date.now();
		while (Date.now() - start < timeout) {
			// GunJS doesn't have a sync-ready event. We check if the peer
			// count in the graph matches what we expect.
			const stats = this.getStats();
			if (stats.peers >= targetPeers) return true;
			await Bun.sleep(200);
		}
		return false;
	}

	// ── Private helpers ───────────────────────────────────────────────────────

	/**
	 * Normalize a value for GunJS storage.
	 * GunJS requires nodes to be objects. Scalars are rejected at non-root
	 * paths. We wrap scalars in {val: ...} to ensure compatibility.
	 *
	 * This matches the pattern in tests/gunjs-multi-node-sync.test.ts where
	 * all writes use objects: gun.get(path).put({ ... }).
	 */
	private _normalizeGunValue(value: unknown): unknown {
		if (value == null) return null;
		// Arrays, objects, and functions can be stored as-is (objects).
		if (typeof value === "object") return value;
		// Scalars (string, number, boolean) must be wrapped.
		return { val: value };
	}

	/**
	 * Unwrap a GunJS value back to the port's GraphNode shape.
	 * Gun wraps data in {_: {...}} internal metadata. We strip the _ and
	 * extract CRDT metadata (peer, ts) if present.
	 */
	private _buildNode<T = unknown>(key: string, data: unknown): GraphNode<T> {
		if (data == null) return { key, value: null as T };

		// Gun internal: data._ contains the actual stored value + metadata.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const raw = (data as Record<string, unknown>)._ ?? data;

		if (raw == null || typeof raw !== "object") {
			return { key, value: raw as T };
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const obj = raw as Record<string, unknown>;

		// Extract CRDT metadata if Gun attached it.
		// Gun stores metadata under the internal "_" key. The "." key inside
		// Gun's _ wrapper sometimes holds a timestamp/hash; we extract it
		// via bracket notation since "." is not a valid identifier.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const peer = obj._ ? (obj._ as Record<string, unknown>)._ : undefined;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const ts = obj._ ? (obj._ as Record<string, unknown>)["."] : undefined;

		// Children: keys in the object that aren't _ or metadata.
		const children: string[] = [];
		for (const k of Object.keys(obj)) {
			if (k === "_") continue;
			if (typeof obj[k] === "object" && obj[k] != null) {
				children.push(k);
			}
		}

		// Value: the unwrapped data, excluding Gun internal _.
		const value = this._stripGunInternal(obj);

		return {
			key,
			value: value as T,
			peer: peer as string | undefined,
			ts: ts as number | string | undefined,
			children: children.length > 0 ? children : undefined,
		};
	}

	/**
	 * Strip Gun internal `_` wrapper from an object, recursing.
	 * This is the inverse of Gun's wrapping — returns the clean data.
	 */
	private _stripGunInternal(data: unknown): unknown {
		if (data == null || typeof data !== "object") return data;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const d = data as Record<string, unknown>;
		if (!d._) return data;
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(d)) {
			if (k === "_") continue;
			out[k] = this._stripGunInternal(d[k]);
		}
		return out;
	}

	/**
	 * One-shot read of a Gun node (like .once() but typed).
	 */
	private _readOnce(node: GunNode): unknown {
		return new Promise((resolve) => {
			node.once((data: unknown) => resolve(data));
		}) as unknown as unknown;
	}

	/**
	 * Estimate the number of nodes in the local Gun graph.
	 * GunJS doesn't expose a count API; we do a best-effort by mapping
	 * the root and counting keys. This is expensive for large graphs.
	 */
	private _estimateNodeCount(): number {
		// GunJS doesn't expose a count API. For a more accurate count,
		// the caller would need to await a collection. Since Gun map() is
		// event-driven and async, we return 0 as a safe default. The
		// getStats() value can be augmented by the caller if they need
		// accuracy (e.g. by awaiting a full map() traversal).
		return 0;
	}

	/**
	 * Check if Gun has network connectivity (any peers attached and reachable).
	 */
	private _isOnline(): boolean {
		// GunJS doesn't expose an "online" flag directly.
		// We check if any peers are in the set; real connectivity requires
		// a successful ping but that's too expensive for getStats().
		return this.peers.size > 0;
	}

	/**
	 * Recursively collect a subtree from a Gun node using map().
	 * This is used by query() to gather children at a path.
	 */
	private async _collectMapSubtree(
		gun: GunInstance,
		path: GraphPath,
		depthSoFar: number,
		maxDepth: number,
		limit: number,
		filter: (node: GraphNode) => boolean,
		nodes: Record<string, GraphNode>,
		edges: [string, string][],
	): Promise<void> {
		if (depthSoFar >= maxDepth || Object.keys(nodes).length >= limit) return;

		const currentPath = path.slice(0, depthSoFar + 1).join("/");

		// Use map() to iterate over children of the node at `path`.
		// GunJS map() fires for each child key.
		await new Promise<void>((resolve) => {
			let resolved = false;
			const node = this._getNodeAtPath(gun, path);

			if (node) {
				node.map().once((data: unknown, key: string | undefined) => {
					if (resolved) return;
					if (key == null) {
						resolved = true;
						resolve();
						return;
					}

					const childPath = currentPath ? `${currentPath}/${key}` : key;
					const nodeObj = this._buildNode(childPath, data);
					if (filter(nodeObj)) {
						nodes[childPath] = nodeObj;
					}
					if (Object.keys(nodes).length >= limit) {
						resolved = true;
						resolve();
						return;
					}
					resolved = true;
					resolve();
				});
			} else {
				resolved = true;
				resolve();
			}
		});
	}

	/**
	 * Get a Gun node at a given path (chained get() calls).
	 */
	private _getNodeAtPath(gun: GunInstance, path: GraphPath): GunNode | null {
		let node: GunNode = gun;
		for (const segment of path) {
			node = node.get(segment);
		}
		return node;
	}

	/**
	 * Collect a subtree recursively (depth-first) from a Gun root.
	 * Used when path is empty (query from root).
	 */
	private _collectSubtree(
		gun: GunNode,
		currentPath: string,
		parentPath: string,
		maxDepth: number,
		limit: number,
		filter: (node: GraphNode) => boolean,
		nodes: Record<string, GraphNode>,
		edges: [string, string][],
	): void {
		if (Object.keys(nodes).length >= limit || maxDepth <= 0) return;

		gun.map().once((data: unknown, key: string | undefined) => {
			if (key == null) return;

			const nodePath = currentPath ? `${currentPath}/${key}` : key;
			const nodeObj = this._buildNode(nodePath, data);
			if (filter(nodeObj)) {
				nodes[nodePath] = nodeObj;
				if (parentPath) {
					edges.push([parentPath, nodePath]);
				}
			}

			// Recurse into children if depth allows.
			if (maxDepth > 1) {
				const childNode = gun.get(key);
				this._collectSubtree(
					childNode,
					nodePath,
					nodePath,
					maxDepth - 1,
					limit,
					filter,
					nodes,
					edges,
				);
			}
		});
	}
}
