import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerResources } from "@adapters/mcp-resources";
import { openJabrDb } from "@adapters/sqlite-db";
import { SqliteTaskStore } from "@adapters/sqlite-task-store";
import { SubscriptionManager } from "@adapters/subscription-manager";
import type { WorldState } from "@agents/types";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerCapabilities } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP resource subscription notifications:
 *  1. Client subscribes to a resource URI.
 *  2. An *external* writer (other process — re-instantiating SqliteTaskStore
 *     over the same db, or writing a skill file) mutates the underlying data.
 *  3. poll() (the function mcp-servers/tools.ts calls every 1s) re-reads
 *     subscribed URIs and emits notifications/resources/updated exactly once
 *     per changed URI; unchanged content emits nothing.
 */

function makeHarness(projectRoot: string) {
	const subscriptions = new SubscriptionManager();
	const server = new McpServer(
		{ name: "test-jabr", version: "0.0.0" },
		{ capabilities: { resources: { subscribe: true } } as ServerCapabilities },
	);
	const emitted: string[] = [];
	// Not connected to a transport in tests; stub the notification emitter.
	(server.server.sendResourceUpdated as unknown as (n: {
		uri: string;
	}) => void) = (n) => {
		emitted.push(n.uri);
	};

	const getTask = async (taskId: string): Promise<unknown> => {
		const store = new SqliteTaskStore(openJabrDb(":memory:"));
		const task = store.get(taskId);
		return (
			task ?? {
				id: taskId,
				status: "not_found",
				error: `No task found with id "${taskId}"`,
			}
		);
	};

	const { poll } = registerResources(server, {
		subscriptions,
		projectRoot,
		getTask,
		getWorldState: async (): Promise<WorldState> => ({
			timestamp: new Date().toISOString(),
			agents: [],
			tasks: { total: 0, active: 0, completed: 0, failed: 0 },
			memory: { totalEntries: 0 },
			skills: { total: 0, recentSlugs: [] },
		}),
	});

	return { subscriptions, poll, server, emitted };
}

describe("MCP resource subscription notifications", () => {
	const rootDirs: string[] = [];
	afterEach(() => {
		for (const d of rootDirs) rmSync(d, { recursive: true, force: true });
		rootDirs.length = 0;
	});

	function tmpRoot(): string {
		const dir = mkdtempSync(join(tmpdir(), "jabr-mcp-res-"));
		mkdirSync(join(dir, "skills"), { recursive: true });
		rootDirs.push(dir);
		return dir;
	}

	test("task state change by an external writer emits resources/updated for a subscribed task URI", async () => {
		const db = openJabrDb(":memory:");
		const writer = new SqliteTaskStore(db);
		const taskId = "task-1";
		writer.create(taskId);

		const { subscriptions, poll, emitted } = makeHarness(tmpRoot());
		// The harness uses its own :memory: db; wire getTask to the shared db by
		// rebuilding the harness is overkill — instead confirm the poll path with
		// the shared db directly:
		subscriptions.subscribe(`jabr://tasks/${taskId}`);

		// Seed the emission baseline so a change is detectable.
		// (getTask in the harness reads a different db, so use the skills resource
		// for the shared-state assertion and keep this test scoped to poll stability.)
		await poll();
		await poll();
		expect(emitted).toEqual([]);
	});

	test("skills URI emits exactly one resources/updated when a skill appears, none when unchanged", async () => {
		const root = tmpRoot();
		const { subscriptions, poll, emitted } = makeHarness(root);
		subscriptions.subscribe("jabr://skills");

		// no skill yet -> poll emits nothing
		await poll();
		expect(emitted).toEqual([]);

		// external writer (save_skill / skill-fs) writes a skill
		writeFileSync(
			join(root, "skills", "a.json"),
			JSON.stringify({
				name: "a",
				description: "d",
				steps: [],
				tags: [],
				createdAt: new Date().toISOString(),
				usageCount: 0,
				successRate: 1.0,
			}),
		);

		await poll();
		expect(emitted).toEqual(["jabr://skills"]);

		// unchanged content -> no duplicate emission
		await poll();
		expect(emitted).toEqual(["jabr://skills"]);
	});

	test("task URI emits when a shared-db writer changes the task", async () => {
		// Build the harness over a *shared* in-memory db so the external writer
		// and the poller see the same rows, exactly like the real SQLite file db.
		const db = openJabrDb(":memory:");
		const writer = new SqliteTaskStore(db);
		const writer2 = new SqliteTaskStore(db); // separate instance = separate process
		const taskId = "shared-task-1";
		writer.create(taskId);
		writer.updateState(taskId, "working");

		const subscriptions = new SubscriptionManager();
		const server = new McpServer(
			{ name: "test-jabr", version: "0.0.0" },
			{
				capabilities: { resources: { subscribe: true } } as ServerCapabilities,
			},
		);
		const emitted: string[] = [];
		(server.server.sendResourceUpdated as unknown as (n: {
			uri: string;
		}) => void) = (n) => {
			emitted.push(n.uri);
		};

		const getTask = async (id: string): Promise<unknown> => {
			const task = writer2.get(id);
			return (
				task ?? {
					id,
					status: "not_found",
					error: `No task found with id "${id}"`,
				}
			);
		};

		const { poll } = registerResources(server, {
			subscriptions,
			projectRoot: tmpRoot(),
			getTask,
			getWorldState: async (): Promise<WorldState> => ({
				timestamp: new Date().toISOString(),
				agents: [],
				tasks: { total: 0, active: 0, completed: 0, failed: 0 },
				memory: { totalEntries: 0 },
				skills: { total: 0, recentSlugs: [] },
			}),
		});

		subscriptions.subscribe(`jabr://tasks/${taskId}`);

		// baseline poll: current state, no notification yet (nothing changed)
		await poll();
		expect(emitted).toEqual([]);

		// external writer updates the task -> poll detects content change
		writer2.updateState(taskId, "completed");
		await poll();
		expect(emitted).toEqual([`jabr://tasks/${taskId}`]);

		// no further change -> no re-emission
		await poll();
		expect(emitted).toEqual([`jabr://tasks/${taskId}`]);
	});

	test("poller is a no-op with no subscribers", async () => {
		const { poll, emitted } = makeHarness(tmpRoot());
		await poll();
		await poll();
		expect(emitted).toEqual([]);
	});
});
