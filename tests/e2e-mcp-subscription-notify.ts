/**
 * End-to-end verification of MCP resource-subscription notifications.
 *
 * Spawns the real jabr MCP tool server (mcp-servers/tools.ts) as a subprocess,
 * connects a real SDK Client over stdio, subscribes to jabr://tasks/{id} and
 * jabr://skills, then:
 *   - mutates the task via a *second* SqliteTaskStore instance (simulating the
 *     orchestrator process writing to the shared memory/jabr.db);
 *   - writes a skill file (simulating save_skill / skill-fs);
 *   - waits for notifications/resources/updated on both URIs.
 *
 * The server's poller runs on a 1s interval, so we wait up to ~4s.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openJabrDb } from "@adapters/sqlite-db";
import { SqliteTaskStore } from "@adapters/sqlite-task-store";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

const TASK_ID = `e2e-task-${Date.now()}`;
const SKILL = `e2e-skill-${Date.now()}`;

// ── setup: create a task in the real db ──────────────────────────────
const db = openJabrDb(); // memory/jabr.db — the same file the MCP server reads
const store = new SqliteTaskStore(db);
store.create(TASK_ID);
console.error(`[e2e] created task ${TASK_ID} in shared db`);

const transport = new StdioClientTransport({
	command: "bun",
	args: ["mcp-servers/tools.ts"],
	stderr: "pipe",
	cwd: process.cwd(),
});
const client = new Client(
	{ name: "e2e-sub-check", version: "0.0.1" },
	{ capabilities: {} },
);

const updated: string[] = [];
// Receive notifications/resources/updated
client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
	updated.push(n.params.uri);
	console.error(`[e2e] NOTIFICATION received for ${n.params.uri}`);
});

await client.connect(transport);
console.error("[e2e] connected; subscribing…");

// Subscribe to both URIs via the real subscribe request
await client.subscribeResource({ uri: `jabr://tasks/${TASK_ID}` });
await client.subscribeResource({ uri: "jabr://skills" });
console.error("[e2e] subscribed to task + skills");

// Read them once so the server establishes a content baseline
await client.readResource({ uri: `jabr://tasks/${TASK_ID}` });
await client.readResource({ uri: "jabr://skills" });
console.error("[e2e] read resources (baseline established)");

// ── mutate via a second writer instance (simulates orchestrator process) ──
const store2 = new SqliteTaskStore(openJabrDb());
store2.updateState(TASK_ID, "working");
store2.appendMessage(TASK_ID, {
	messageId: `m-${Date.now()}`,
	role: "agent",
	kind: "message",
	parts: [{ kind: "text", text: "e2e progress" }],
	contextId: TASK_ID,
});
store2.updateState(TASK_ID, "completed");
console.error("[e2e] external writer updated task state → completed");

// ── write a skill file (simulates save_skill) ────────────────────────
const skillDir = join(process.cwd(), "skills");
mkdirSync(skillDir, { recursive: true });
writeFileSync(
	join(skillDir, `${SKILL}.json`),
	JSON.stringify({
		name: SKILL,
		description: "e2e skill",
		steps: ["step"],
		tags: ["e2e"],
		createdAt: new Date().toISOString(),
		usageCount: 0,
		successRate: 1.0,
	}),
);
console.error(`[e2e] wrote skill ${SKILL}.json`);

// ── wait for notifications ────────────────────────────────────────────
const deadline = Date.now() + 6_000;
while (Date.now() < deadline && updated.length < 2) {
	await new Promise((r) => setTimeout(r, 200));
}

console.error(`[e2e] received notifications: ${JSON.stringify(updated)}`);
const taskUri = `jabr://tasks/${TASK_ID}`;
const taskNotified = updated.includes(taskUri);
const skillsNotified = updated.includes("jabr://skills");

console.log(
	`RESULT task_notified=${taskNotified} skills_notified=${skillsNotified}`,
);

// ── cleanup ───────────────────────────────────────────────────────────
try {
	await client.unsubscribeResource({ uri: taskUri });
} catch {}
try {
	await client.unsubscribeResource({ uri: "jabr://skills" });
} catch {}
await client.close();
try {
	await transport.close();
} catch {}
try {
	store.updateState(TASK_ID, "canceled");
} catch {}

if (!taskNotified || !skillsNotified) {
	console.error("[e2e] FAILED: expected task + skills notifications");
	process.exit(1);
}
console.error("[e2e] PASS: both notification types received");
process.exit(0);
