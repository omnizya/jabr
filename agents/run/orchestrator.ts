import { A2AClient } from "@adapters/a2a-client";
import { startBunWebSocketAdapter } from "@adapters/bun-websocket-adapter.ts";
import { HeadroomAdapter } from "@adapters/headroom";
import { HermesKanbanAdapter } from "@adapters/hermes-kanban";
import { A2AServer } from "@adapters/http/a2a-server";
import { GitHubWebhookAdapter } from "@adapters/http/github-webhook.ts";
import { createLlmAdapter } from "@adapters/llm/factory";
import { MemPalaceAdapter } from "@adapters/mem-palace";
import { RateLimiter } from "@adapters/rate-limit";
import { openJabrDb } from "@adapters/sqlite-db.ts";
import { SqliteMemoryStore } from "@adapters/sqlite-memory-store.ts";
import { SqliteTaskStore } from "@adapters/sqlite-task-store.ts";
import { SettlementLedger } from "@adapters/x402/settlement-ledger.ts";
import { X402Client } from "@adapters/x402/x402-client";
import { X402Server } from "@adapters/x402/x402-server";
import type { ResolvedCaller } from "@agents/types";
import { jabrUrlForPort, jabrUrlOrUndefined } from "@config/jabr-config";
import { ORCHESTRATOR_CARD, OrchestratorAgent } from "@core/orchestrator";
import { type AgentConfig, ToolRouter } from "@core/tool-router";
import { PluginEventBusImpl } from "@ports/plugin-event-bus";
import type { DomainEventBus } from "@ports/plugin-event-bus.types";
import type { RealtimePort } from "@ports/realtime-port";
import { ApiKeyRegistry } from "@security/api-key-registry";
import { bridgeRealtimeToPlugin, initLifecycle } from "./lifecycle.ts";

if (import.meta.main) {
	const PORT = 4000;

	// --- Settlement infrastructure ---
	if (!process.env.JABR_X402_HMAC_SECRET) {
		console.error(
			"Fatal: JABR_X402_HMAC_SECRET environment variable is required",
		);
		process.exit(1);
	}

	const ledger = new SettlementLedger({
		hmacSecret: process.env.JABR_X402_HMAC_SECRET,
		chainEndpoint: process.env.JABR_X402_CHAIN_ENDPOINT ?? undefined,
		defaultAutoRefillThreshold:
			Number(process.env.JABR_X402_AUTO_REFILL_THRESHOLD) || 0,
		defaultAutoRefillAmount:
			Number(process.env.JABR_X402_AUTO_REFILL_AMOUNT) || 0,
	});
	const x402Client = new X402Client({
		ledger,
		delegatorUrl: jabrUrlForPort(PORT),
		defaultCurrency: process.env.JABR_X402_CURRENCY ?? undefined,
	});
	const x402Server = new X402Server(ledger, jabrUrlForPort(PORT));

	const budget = new HeadroomAdapter();
	const rateLimiter = new RateLimiter();
	const registryClient = new A2AClient(budget);
	const db = openJabrDb(); // memory/jabr.db
	const taskStore = new SqliteTaskStore(db);
	const memory = new SqliteMemoryStore(db, { mirrorFile: null }); // sqlite is source of truth; no .md mirror
	const llmPort = createLlmAdapter(budget);

	// Real-time event transport: native Bun WebSocket server on port 4008.
	// Clients subscribe to task-scoped rooms (task-{id}) to receive lifecycle
	// events (task:created, task:progress, task:completed, task:failed).
	const realtime: RealtimePort = startBunWebSocketAdapter({ port: 4008 });

	// --- Plugin event bus ---
	// Canonical domain event bus (in-process pub/sub). Emits lifecycle payloads
	// alongside the RealtimePort transport layer.
	const pluginEventBus = new PluginEventBusImpl({
		onError: (error, eventName, subscriptionId) => {
			console.error(
				`[PluginEventBus] handler for "${eventName}" (${subscriptionId}) threw:`,
				error,
			);
		},
	});

	// Bridge realtime transport events to plugin bus (wire → plugin projection).
	bridgeRealtimeToPlugin(realtime, pluginEventBus);

	// Wire orchestrator lifecycle events — agent:online on start, agent:offline
	// on SIGINT/SIGTERM, agent:error on uncaught exceptions and unhandled rejections.
	const orchestratorLifecycle = initLifecycle(
		realtime,
		"orchestrator",
		PORT,
		pluginEventBus,
	);
	orchestratorLifecycle.announceOnline();
	process.on("uncaughtException", (e) => {
		orchestratorLifecycle.uncaughtHandler(e);
		console.error(`[Run:Orchestrator] uncaught exception:`, e);
	});

	// --- Static agent config (replaces DynamicRegistry per YAGNI) ---
	// The Dispatcher discovers agents at boot by fetching their Agent Cards
	// from well-known endpoints. The resulting static config is passed to
	// ToolRouter, which handles all routing, URL resolution, and pricing
	// without any async discovery protocol or health checks.
	const seedUrls: Record<string, string> = {
		oracle: jabrUrlForPort(4001),
		librarian: jabrUrlForPort(4002),
		explorer: jabrUrlForPort(4003),
		designer: jabrUrlForPort(4004),
		fixer: jabrUrlForPort(4005),
		scientist: jabrUrlForPort(4006),
		jarvis: jabrUrlForPort(1337),
		verification: jabrUrlForPort(4009),
	};

	// Fetch agent cards and build static config. The x402Server is wired from
	// these cards (pricing metadata) — no DynamicRegistry needed.
	const agentConfigs: AgentConfig[] = [];
	for (const [name, url] of Object.entries(seedUrls)) {
		const card = await registryClient.fetchCard(url);
		if (!card) {
			console.warn(
				`[Run:Orchestrator] failed to fetch card for ${name} from ${url}`,
			);
			continue;
		}
		console.log(`[Run:Orchestrator] loaded card for ${card.name} from ${url}`);
		agentConfigs.push({ name, url, card });

		// Wire agent card into x402 server so it knows which agents expect payment.
		if (card.pricing?.settlement !== undefined) {
			x402Server.updateFromCard(card, card.pricing.settlement);
		}
	}

	// Build agent map for ToolRouter.
	const agentMap: Record<string, AgentConfig> = {};
	for (const cfg of agentConfigs) {
		agentMap[cfg.name] = cfg;
	}

	const palace = new MemPalaceAdapter();
	const kanban = new HermesKanbanAdapter(process.env.HERMES_KANBAN_BOARD);

	const toolRouter = new ToolRouter({
		agents: agentMap,
		registry: registryClient,
		x402Client,
		budget,
		memory,
		knowledge: palace,
		kanban,
		realtime,
		pluginEventBus,
	});

	const agent = new OrchestratorAgent(toolRouter, taskStore, memory);

	// --- API key registry (per-key authentication + ACL) ---
	// Loads keys from JSON env var A2A_API_KEYS. Each entry is:
	//   { key: string, description: string, allowedAgents: string[], enabled?: boolean }
	// Empty allowedAgents = wildcard (all agents).
	let apiKeyRegistry: ApiKeyRegistry | undefined;
	const keysJson = process.env.A2A_API_KEYS;
	if (keysJson) {
		try {
			const entries = JSON.parse(keysJson);
			apiKeyRegistry = new ApiKeyRegistry(entries);
			console.log(
				`[Run:Orchestrator] loaded ${entries.length} API key(s) from A2A_API_KEYS`,
			);
		} catch (e) {
			console.error(`[Run:Orchestrator] failed to parse A2A_API_KEYS: ${e}`);
			process.exit(1);
		}
	}

	// Auth is mandatory at the orchestrator boundary. Refuse to start
	// without a configured registry or legacy token so the endpoint is never
	// accidentally exposed without authentication.
	const requireAuth = true;
	const legacyToken = process.env.A2A_AUTH_TOKEN;
	if (!apiKeyRegistry && !legacyToken) {
		console.error(
			"Fatal: A2A_API_KEYS or A2A_AUTH_TOKEN environment variable is required to start the orchestrator",
		);
		process.exit(1);
	}

	// Legacy single-token mode: build a registry with one wildcard key.
	if (!apiKeyRegistry && legacyToken) {
		console.warn(
			"[Run:Orchestrator] using legacy A2A_AUTH_TOKEN (single shared token, consider migrating to A2A_API_KEYS)",
		);
		apiKeyRegistry = new ApiKeyRegistry([
			{
				key: legacyToken,
				description: "legacy-shared-token",
				allowedAgents: [],
				enabled: true,
			},
		]);
	}

	// GitHub webhook adapter: receives X-Hub-Signature-256-verified events on port
	// 4007 and delegates them to the orchestrator over A2A. The webhook secret and
	// a GitHub PAT (for comment / check-run actions) are read from env so the
	// adapter stays usable in CI without local secrets.
	const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET ?? "change-me";
	const ghToken = process.env.GITHUB_TOKEN ?? undefined;
	const ghDelegate =
		process.env.GITHUB_WEBHOOK_DELEGATE_URL ?? jabrUrlForPort(PORT);
	const githubWebhook = new GitHubWebhookAdapter({
		webhookSecret,
		token: ghToken,
		port: 4007,
		delegateUrl: ghDelegate,
		defaultRepo: process.env.GITHUB_REPO ?? "omnizya/jabr",
	});
	githubWebhook.start();

	const server = new A2AServer(
		{
			port: PORT,
			card: { ...ORCHESTRATOR_CARD, url: jabrUrlForPort(PORT) },
			apiKeyRegistry,
			requireAuth,
			async onTask(text: string, caller?: ResolvedCaller): Promise<string> {
				const taskId = crypto.randomUUID();
				console.log(`[Run:Orchestrator] received task ${taskId}`);
				taskStore.create(taskId);
				await agent.execute(taskId, text, caller);
				const task = taskStore.get(taskId);
				const lastMsg = task?.messages.filter((m) => m.role === "agent").pop();
				return (
					lastMsg?.parts.find((p) => p.kind === "text")?.text ?? "No response"
				);
			},
			async onWorldState() {
				return agent.getWorldState();
			},
		},
		rateLimiter,
		x402Server,
		apiKeyRegistry,
	);

	server.start();

	const shutdown = () => {
		console.log("[Orchestrator] received signal, shutting down...");
		server.shutdown().then(() => {
			orchestratorLifecycle.announceOffline();
			process.exit(0);
		});
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}
