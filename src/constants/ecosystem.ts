/**
 * ecosystem.ts — Canonical source of truth for Jabr ecosystem parameters.
 *
 * Everything that pins the ecosystem together lives here: agent ports,
 * well-known endpoint paths, A2A JSON-RPC method names, default service
 * URLs, and the dev CORS origin allowlist. Values are read from the
 * environment with sensible defaults so a bare `bun run dev` just works.
 *
 * Convention: camelCase for object keys, ALL_CAPS_SNAKE for scalar exports.
 */

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/**
 * Resolve an integer port from the environment, falling back to `fallback`
 * when the variable is unset or not a positive integer. Replaces the old
 * `process.env.X_PORT | <default>` bitwise-OR idiom (wrong operator).
 */
function portFromEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	const n = Number(raw);
	return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * The A2A / service port for every agent and infrastructure process.
 *
 *   orchestrator 4000, oracle 4001, librarian 4002, explorer 4003,
 *   designer 4004, fixer 4005, scientist 4006, githubWebhook 4007,
 *   realtime 4008, verification 4009, jarvis 1337
 *
 * Each value is env-overridable via the documented variable name.
 */
export const JABR_PORTS = {
	orchestrator: portFromEnv("ORCHESTRATOR_PORT", 4000),
	oracle: portFromEnv("ORACLE_PORT", 4001),
	librarian: portFromEnv("LIBRARIAN_PORT", 4002),
	explorer: portFromEnv("EXPLORER_PORT", 4003),
	designer: portFromEnv("DESIGNER_PORT", 4004),
	fixer: portFromEnv("FIXER_PORT", 4005),
	scientist: portFromEnv("SCIENTIST_PORT", 4006),
	githubWebhook: portFromEnv("GITHUB_WEBHOOK_PORT", 4007),
	realtime: portFromEnv("JABR_REALTIME_PORT", 4008),
	verification: portFromEnv("VERIFICATION_PORT", 4009),
	jarvis: portFromEnv("JARVIS_PORT", 1337),
} as const;

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** Well-known and infrastructure HTTP paths served by the ecosystem. */
export const JABR_ENDPOINTS = {
	/** A2A agent card descriptor. */
	agentCard: "/.well-known/agent-card.json",
	/** Live world-state aggregate. */
	worldState: "/.well-known/world-state",
	/** Liveness probe. */
	health: "/health",
	/** Readiness probe. */
	ready: "/ready",
	/** Realtime event ingestion (POST). */
	emit: "/emit",
	/** Webhook listeners (GitHub / Telegram / WhatsApp). */
	webhook: "/webhook",
	/** JSON-RPC entry point (tasks/send). */
	root: "/",
} as const;

/** A2A v1.0 JSON-RPC method names. */
export const A2A_METHODS = {
	tasksSend: "tasks/send",
	tasksSendSubscribe: "tasks/sendSubscribe",
	tasksCancel: "tasks/cancel",
	tasksGet: "tasks/get",
} as const;

// ---------------------------------------------------------------------------
// Default service URLs
// ---------------------------------------------------------------------------

/** Fallback 9Router gateway URL when NINEROUTER_URL is unset (dev default). */
export const NINEROUTER_URL_DEFAULT = "http://localhost:20127";
/** Fallback model when NINEROUTER_MODEL is unset. */
export const NINEROUTER_MODEL_DEFAULT = "openrouter/minimax/minimax-m3:free";
/** Fallback orchestrator URL when JABR_URL / ORCHESTRATOR_URL is unset. */
export const JABR_URL_DEFAULT = "http://localhost:4000";

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

/**
 * Dev CORS allowlist used when ALLOWED_ORIGINS is empty. Single source of
 * truth consumed by agents/utils/rpc.ts and bun-websocket-adapter.ts.
 */
export const DEV_ALLOWED_ORIGINS = [
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
] as const;