// scripts/create-triage.ts — bulk-create Jabr triage tasks
// Run: bun scripts/create-triage.ts

const tasks = [
	// ── Critical Bugs ──
	{
		title: "BUG: system:health WebSocket validator rejects all valid events",
		priority: 1,
		body: `## Summary\nBunWebSocketAdapter.isValidRealtimeEvent requires Array.isArray(e.tasks) and Array.isArray(e.memory). But tasks and memory in every actual system:health event are objects, not arrays. Any system:health broadcast gets silently rejected — it will never reach clients.\n\n## Severity\nHigh — breaks realtime monitoring\n\n## Files\n- agents/adapters/bun-websocket-adapter.ts\n\n## Proposed Fix\nChange validator to check for objects, not arrays. Or update the event shape to use arrays.\n\n## Verification\nSend a system:health event via WebSocket, verify client receives it.`,
	},
	{
		title: "BUG: MCP getTask reads nonexistent files",
		priority: 2,
		body: `## Summary\nIn mcp-servers/tools.ts, getTask(taskId) reads from memory/task-{taskId}.json. Tasks are stored in SQLite, not individual JSON files. Nothing writes those files. This always returns status: "not_found".\n\n## Severity\nMedium — MCP task lookup is broken\n\n## Files\n- mcp-servers/tools.ts\n- agents/adapters/sqlite-task-store.ts\n\n## Proposed Fix\nRead from SQLite task store instead of filesystem.\n\n## Verification\nCall MCP getTask with a valid taskId, verify it returns the actual task.`,
	},
	{
		title: "BUG: Telegram webhook rejects when no secret configured",
		priority: 2,
		body: `## Summary\nTelegram webhook auth check: if webhookSecret is an empty string (TELEGRAM_WEBHOOK_SECRET not set), EVERY request is rejected — including legitimate webhooks. The condition should guard with if (adapter.webhookSecret && ...).\n\n## Severity\nMedium — blocks Telegram integration in dev\n\n## Files\n- agents/adapters/http/telegram-webhook.ts\n\n## Proposed Fix\nChange the auth check to only reject if webhookSecret is set AND doesn't match.\n\n## Verification\nSend a webhook request without configuring TELEGRAM_WEBHOOK_SECRET, verify it passes.`,
	},
	{
		title: "BUG: SkillFS.save silently drops updates",
		priority: 2,
		body: `## Summary\nSkillFS.save returns false when a skill slug already exists. Every caller (Librarian, Fixer) ignores the return value. Skills are immutable once written — the self-improvement loop can never update a skill.\n\n## Severity\nMedium — self-improvement is frozen\n\n## Files\n- agents/adapters/skill-fs.ts\n- agents/core/librarian.ts\n- agents/core/fixer.ts\n\n## Proposed Fix\nMake SkillFS.save update existing skills (upsert), or have callers check return value.\n\n## Verification\nRun the same skill task twice, verify the skill file updates.`,
	},
	{
		title: "BUG: WorldState e2e test assertion excludes submitted tasks",
		priority: 3,
		body: `## Summary\ngetWorldState computes total = submitted + active + completed + failed + canceled. The e2e test checks total === active + completed + failed + canceled — omitting submitted. Any task created but not yet worked makes this fail. Passes only because test fires a task that immediately transitions to working.\n\n## Severity\nMedium — test gives false confidence\n\n## Files\n- scripts/demo.ts (or wherever the WorldState assertion lives)\n\n## Proposed Fix\nInclude submitted in the test assertion.\n\n## Verification\nCreate a task, check WorldState.total includes it.`,
	},
	// ── Security ──
	{
		title: "SEC: x402 HMAC secret defaults to public string",
		priority: 1,
		body: `## Summary\nJABR_X402_HMAC_SECRET defaults to "dev-secret-change-in-prod" in run/orchestrator.ts. If not set, the entire x402 settlement layer runs on a known-public secret. All payment tokens are forgeable.\n\n## Severity\nHigh — payment tokens can be forged\n\n## Files\n- agents/run/orchestrator.ts\n\n## Proposed Fix\nMake the env var required (no default). Fail startup if not set.\n\n## Verification\nStart Jabr without JABR_X402_HMAC_SECRET, verify it refuses to start.`,
	},
	{
		title: "SEC: verifyChainProof is a stub that accepts anything",
		priority: 2,
		body: `## Summary\nThe on-chain proof verifier in settlement-ledger.ts returns confirmed: true for any non-empty token.proof string. When chainEndpoint is set, on-chain verification appears to run but always passes. Marketing implies real settlement.\n\n## Severity\nHigh — false sense of security\n\n## Files\n- agents/adapters/x402/settlement-ledger.ts\n\n## Proposed Fix\nEither implement real chain RPC calls or clearly document as dev-only stub and disable in production.\n\n## Verification\nCall verifyChainProof with invalid proof, verify it still returns confirmed (then fix).`,
	},
	{
		title: "SEC: API key hardcoded in source",
		priority: 2,
		body: `## Summary\nNINEROUTER_KEY defaults to "sk-ac4453b102b24d2f-9eda9y-838fcb60" in both 9router.ts and search-9router.ts. It's also in .env.example. Pattern is wrong — hardcoded credentials in source tracked by git.\n\n## Severity\nMedium\n\n## Files\n- agents/adapters/llm/9router.ts\n- agents/adapters/search-9router.ts\n\n## Proposed Fix\nRemove default, make env var required.\n\n## Verification\nStart without NINEROUTER_KEY, verify clear error message.`,
	},
	// ── Architecture / Dead Code ──
	{
		title: "ARCH: executeConsensus / consensus engine never called",
		priority: 3,
		body: `## Summary\nexecuteConsensus exists on OrchestratorAgent but has zero call sites. executeWithDepth (the hot path) calls routeTask → single agent. The consensus engine is complete and correct but runs in zero tasks.\n\n## Severity\nLow (no functional impact, but core feature dormant)\n\n## Files\n- agents/core/orchestrator.ts\n- agents/core/cognitive-loop.ts\n\n## Proposed Fix\nActivate consensus for tasks with multiple matching agents, or remove if not planned.\n\n## Verification\nSend a task that matches multiple agents, verify consensus is used.`,
	},
	{
		title: "ARCH: Handover mechanism fully dormant",
		priority: 3,
		body: `## Summary\nThe %%HANDOVER%% decoder in executeWithDepth is real and correct. Oracle has an LLM path that can emit it. Problem: DynamicRegistry routes most tasks away from Oracle to more specific agents. Handover works in principle, rarely triggers in practice.\n\n## Severity\nLow (design intent vs reality mismatch)\n\n## Files\n- agents/core/orchestrator.ts\n- agents/core/oracle.ts\n\n## Proposed Fix\nEither document as "Oracle-only fallback" or wire more agents to emit handovers.\n\n## Verification\nForce a task to Oracle with LLM prompt to handover, verify transfer happens.`,
	},
	{
		title: "ARCH: DynamicRegistry.initialized field is unused",
		priority: 3,
		body: `## Summary\nThe field is declared but never set to true. ensureReady() checks this.entries.size > 0 instead. If all agents are down after retries, every subsequent routeTask call re-enters discoverWithRetry — 30 more seconds of polling on every request.\n\n## Severity\nLow (performance issue)\n\n## Files\n- agents/adapters/dynamic-registry.ts\n\n## Proposed Fix\nEither use the field or remove it.\n\n## Verification\nStop all agents, send a task, verify behavior.`,
	},
	// ── Routing Issues ──
	{
		title: "ROUTE: Tag scoring double-counts exact matches",
		priority: 3,
		body: `## Summary\nDynamicRegistry.matchAgent gives +3 for exact word match AND then still runs the substring loop (which can add another +1 for the same tag). The scoring tiers don't stack cleanly.\n\n## Severity\nLow (correctness of routing quality)\n\n## Files\n- agents/adapters/dynamic-registry.ts\n\n## Proposed Fix\nSkip substring check for tags already matched exactly.\n\n## Verification\nTest routing with a task that has both exact and substring matches, verify score.`,
	},
	{
		title: "ROUTE: CognitiveLoop relevance scoring has no stop-word filter",
		priority: 3,
		body: `## Summary\ntaskWords = taskText.split(/\\s+/) — no stop-word removal. Words like "the", "a", "this", "is" inflate relevance scores for any agent whose response contains them (all do). The relevance signal is largely noise.\n\n## Severity\nLow (quality of consensus scoring)\n\n## Files\n- agents/core/cognitive-loop.ts\n\n## Proposed Fix\nAdd stop-word list or use a tokenizer.\n\n## Verification\nSend a task with only stop-words, verify scoring behavior.`,
	},
	{
		title: "ROUTE: Budget deduction uses character count as token proxy",
		priority: 3,
		body: `## Summary\ncostPerToken * userText.length — characters, not tokens. Tokens are ~4 chars. Budget tracking is off by 4x for every agent that declares costPerToken.\n\n## Severity\nLow (cosmetic until real billing)\n\n## Files\n- agents/adapters/headroom.ts (or wherever budget is calculated)\n\n## Proposed Fix\nUse actual token count or document as "character-based approximation".\n\n## Verification\nSend a 400-char task, verify budget deduction matches expectation.`,
	},
	// ── MCP Gaps ──
	{
		title: "MCP: Resource subscriptions wired but never triggered",
		priority: 3,
		body: `## Summary\nMCP server advertises resources.subscribe: true. Clients can subscribe to resource URIs. But when task state changes or skills are written, nothing calls subscriptions.hasSubscribers(uri) and pushes a notification.\n\n## Severity\nLow (feature incomplete but not breaking)\n\n## Files\n- mcp-servers/tools.ts\n- agents/adapters/subscription-manager.ts\n\n## Proposed Fix\nWire subscription notifications to task/skill lifecycle events.\n\n## Verification\nSubscribe to a resource URI, change a task, verify notification received.`,
	},
	{
		title: "MCP: Elicitation advertised but always declines",
		priority: 3,
		body: `## Summary\nmcp-servers/tools.ts advertises capabilities: { elicitation: { form: {} } }. But NullElicitationPort declines every request. Clients will always get "Authorization declined by user."\n\n## Severity\nLow (feature advertised but non-functional)\n\n## Files\n- mcp-servers/tools.ts\n\n## Proposed Fix\nEither implement real elicitation (prompt user via hermes/omnizya) or remove from capabilities.\n\n## Verification\nCall elicitation tool, verify it declines.`,
	},
	// ── Stale Docs ──
	{
		title: "DOC: Oracle .md says deterministic, but it's LLM-capable",
		priority: 3,
		body: `## Summary\noracle.md says "Deterministic keyword matcher — NOT LLM-driven". But run/oracle.ts constructs new OracleAgent(taskStore, new SkillFS("skills"), llm) — three args including LLM. Oracle IS LLM-capable. The .md is stale.\n\n## Severity\nLow (documentation accuracy)\n\n## Files\n- agents/core/oracle.md\n\n## Proposed Fix\nUpdate oracle.md to reflect LLM capability.\n\n## Verification\nN/A`,
	},
	{
		title: "DOC: Jarvis .md describes bug that's already fixed",
		priority: 3,
		body: `## Summary\njarvis.md says "execute does NOT call taskStore.updateState / appendMessage". The actual code does exactly that. The .md is stale.\n\n## Severity\nLow\n\n## Files\n- agents/core/jarvis.md\n\n## Proposed Fix\nUpdate or remove the stale warning.\n\n## Verification\nN/A`,
	},
	{
		title: "DOC: CANONICAL.md routing scores wrong",
		priority: 3,
		body: `## Summary\nCANONICAL.md says "+2 per tag substring match". Actual code is +1 for substring, +3 for exact word. Documentation score values are wrong.\n\n## Severity\nLow\n\n## Files\n- CANONICAL.md\n\n## Proposed Fix\nUpdate CANONICAL.md to match actual scoring.\n\n## Verification\nN/A`,
	},
	// ── Agent Activation Plan ──
	{
		title: "AGENT: Wire LLM to Fixer (keyword matcher → real code generation)",
		priority: 2,
		body: `## Summary\nFixer returns canned bug-fix steps regardless of input. Constructor needs llm?: LlmPort. In executeTask, try LLM first (system prompt: TypeScript/Python specialist), fall back to keyword switch. Follow Oracle's pattern.\n\n## Files\n- agents/core/fixer.ts\n- agents/run/fixer.ts\n\n## Proposed Fix\nAdd LlmPort to constructor, wire NineRouterLlmAdapter, keep keyword fallback.\n\n## Verification\nSend "fix the login flow bug", verify LLM-generated response.`,
	},
	{
		title: "AGENT: Wire LLM to Librarian (raw search results → synthesis)",
		priority: 2,
		body: `## Summary\nLibrarian calls search.search() but returns raw results with no synthesis. LLM should summarize findings into structured answer with citations.\n\n## Files\n- agents/core/librarian.ts\n- agents/run/librarian.ts\n\n## Proposed Fix\nAdd LlmPort to constructor, after search results, call LLM to synthesize.\n\n## Verification\nSend "research MCP protocol", verify synthesized answer not raw results.`,
	},
	{
		title: "AGENT: Wire LLM to Scientist (generate Python, execute, narrate)",
		priority: 2,
		body: `## Summary\nScientist already uses MCP run_python but returns hardcoded strings. LLM should: (1) generate Python code for the task, (2) execute via MCP, (3) narrate the output. Two LLM calls per task.\n\n## Files\n- agents/core/scientist.ts\n- agents/run/scientist.ts\n\n## Proposed Fix\nAdd LlmPort to constructor, restructure execute to: LLM→code→run_python→LLM→narrative.\n\n## Verification\nSend "analyze this CSV data", verify Python is generated and executed.`,
	},
];

let passed = 0;
let failed = 0;

for (const task of tasks) {
	const bodyFile = `/tmp/jabr-triage-${crypto.randomUUID()}.md`;
	await Bun.write(bodyFile, task.body);

	const proc = Bun.spawn(
		[
			"hermes",
			"kanban",
			"create",
			task.title,
			`--priority`,
			String(task.priority),
			`--body`,
			task.body,
			`--triage`,
			`--idempotency-key`,
			`jabr-triage-${task.title
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.slice(0, 50)}`,
		],
		{
			stdout: "pipe",
			stderr: "pipe",
		},
	);

	const output = await new Response(proc.stdout).text();
	const exitCode = await proc.exited;

	if (exitCode === 0) {
		console.log(`✓ ${task.title.slice(0, 60)}`);
		passed++;
	} else {
		console.log(`✗ ${task.title.slice(0, 60)}: ${output}`);
		failed++;
	}
}

console.log(`\nResults: ${passed} created, ${failed} failed`);
