// ports/graph-memory-port.ts
// Hexagonal port: distributed graph memory contract.
// Adapters implement this (e.g. GunJSMemoryAdapter.ts).
// Backed by GunJS CRDT — set/get/subscribe/query with automatic
// conflict resolution via last-writer-wins per peer + vector clock merge.
//
// Scope note (from realtime-graph-storage-research.md §2):
// - Multi-node sync, offline-first, P2P agent communication
// - Built-in CRDT conflict resolution; not for >1000 writes/sec
// - SEA (Security, Encryption, Authorization) for E2E encryption
// - Storage adapters: localStorage, SQLite, S3, IPFS

/** A graph path used for traversal queries. Each segment is a node key. */
export type GraphPath = string[];

/** A single graph node returned by get/query. */
export interface GraphNode<T = unknown> {
	key: string;
	value: T;
	/** Peer that last wrote this node (CRDT tie-breaker metadata). */
	peer?: string;
	/** Logical timestamp or vector-clock entry for conflict resolution. */
	ts?: number | string;
	/** Children node keys when the node is a graph collection. */
	children?: string[];
}

/** Subscription callback for live graph updates. */
export type GraphSubscribeCallback<T = unknown> = (
	node: GraphNode<T> | null,
) => void;

/** Query result shape — partial graph rooted at the query path. */
export interface GraphQueryResult {
	/** Matched nodes keyed by their full path (joined with "."). */
	nodes: Record<string, GraphNode>;
	/** Edges represented as [fromKey, toKey] pairs. */
	edges: [string, string][];
}

/** Pager for large graph queries. */
export interface GraphQueryOptions {
	/** Maximum nodes to return; omit for unbounded. */
	limit?: number;
	/** Path depth to traverse from the root; omit for full depth. */
	depth?: number;
	/** Optional filter predicate on node values. */
	filter?: (node: GraphNode) => boolean;
}

/** Statistics snapshot from the underlying graph store. */
export interface GraphMemoryStats {
	/** Total nodes in the local graph. */
	nodes: number;
	/** Total edges (parent→child relationships) in the local graph. */
	edges: number;
	/** Number of connected peers (P2P synchronization partners). */
	peers: number;
	/** Whether the local node currently has network connectivity. */
	online: boolean;
}

/**
 * GraphMemoryPort — hexagonal contract for a distributed, CRDT-backed
 * graph data store.
 *
 * Implementers: GunJSMemoryAdapter (GunJS), InMemoryGraphAdapter (tests).
 */
export interface GraphMemoryPort {
	/**
	 * Set a node in the graph. Creates or overwrites the node at `key`.
	 * Value may be any JSON-serializable structure; nested objects become
	 * child nodes automatically in graph-backed adapters.
	 *
	 * CRDT behavior: concurrent writes to the same key merge by
	 * last-writer-wins per peer; vector-clock metadata is attached
	 * automatically by the adapter.
	 */
	set(key: string, value: unknown): Promise<void>;

	/**
	 * Get a node by key. Returns the node with its CRDT metadata, or null
	 * if the key does not exist in the local store (may still be pending
	 * sync from a peer).
	 */
	get<T = unknown>(key: string): Promise<GraphNode<T> | null>;

	/**
	 * Subscribe to live changes on a key. Returns an unsubscribe function.
	 * The callback fires on every local or remote update to the node,
	 * including deletions (node === null).
	 */
	subscribe<T = unknown>(
		key: string,
		callback: GraphSubscribeCallback<T>,
	): () => void;

	/**
	 * Query the graph starting from a path. Returns matched nodes and edges
	 * within the optional limit/depth/filter constraints.
	 *
	 * Example: query(["agents", "oracle"]) traverses from the "agents" root
	 * into the "oracle" child and returns its subtree.
	 */
	query(
		path: GraphPath,
		options?: GraphQueryOptions,
	): Promise<GraphQueryResult>;

	/**
	 * Delete a node and its subtree. Equivalent to set(key, null) in CRDT
	 * adapters — the tombstone propagates to peers.
	 */
	delete(key: string): Promise<void>;

	/**
	 * Ping a peer by URL and return whether it is reachable. Used for
	 * connectivity checks and peer health monitoring.
	 */
	ping(peerUrl: string): Promise<boolean>;

	/**
	 * Attach a peer for P2P synchronization. Peers exchange graph state
	 * automatically after attachment.
	 */
	attachPeer(peerUrl: string): Promise<void>;

	/**
	 * Detach a previously attached peer.
	 */
	detachPeer(peerUrl: string): Promise<void>;

	/**
	 * Current graph statistics including local node/edge counts and
	 * connected peer count.
	 */
	getStats(): GraphMemoryStats;

	/**
	 * Wait until the local graph has synchronized with at least `minPeers`
	 * peers, or until the timeout elapses. Resolves true when synced,
	 * false on timeout. Useful for bootstrapping before reads.
	 */
	waitForSync(minPeers?: number, timeoutMs?: number): Promise<boolean>;
}


