import { describe, expect, test } from "bun:test";
import type { AgentCard } from "@agents/types";
import { encodeHandover } from "@agents/types";
import { OrchestratorAgent } from "@core/orchestrator";
import { ToolRouter } from "@core/tool-router";
import type { AgentRegistryPort } from "@ports/agent-registry";
import type { MemoryStorePort } from "@ports/memory-store";
import type { TaskStorePort } from "@ports/task-store";

// ---- real-ish mocks for the handover E2E test ----

function noopMemory(): MemoryStorePort {
	return {
		read: () => "",
		append: () => {},
		listSessions: () => [],
		deleteSession: () => false,
		getSession: () => null,
		saveSession: () => {},
	};
}

type RecordedTask = {
	state: "submitted" | "working" | "completed" | "failed";
	messages: Array<{
		role: string;
		parts: Array<{ kind: string; text: string }>;
	}>;
};

function makeTaskStore(): TaskStorePort & {
	tasks: Record<string, RecordedTask>;
} {
	const tasks: Record<string, RecordedTask> = {};
	return {
		create(taskId: string): Record<string, unknown> {
			tasks[taskId] = {
				state: "submitted",
				messages: [],
			} as unknown as RecordedTask;
			return { id: taskId, state: "submitted", messages: [], artifacts: [] };
		},
		get(taskId: string): Record<string, unknown> | undefined {
			return tasks[taskId] as unknown as Record<string, unknown> | undefined;
		},
		updateState(taskId: string, state: string) {
			if (tasks[taskId]) (tasks[taskId] as any).state = state;
		},
		appendMessage(taskId: string, msg: any) {
			if (!tasks[taskId]) return;
			const parts: Array<{ kind: string; text: string }> = [];
			for (const p of (msg as any).parts ?? []) {
				if (p.kind === "text") parts.push({ kind: "text", text: p.text });
			}
			tasks[taskId].messages.push({ role: msg.role, parts });
		},
		appendArtifact: () => {},
		listByState: () => [],
		getTransitionHistory: () => [],
		tasks,
	};
}

// A registry stub that returns a canned response for each agent URL.
function makeRegistry(responses: Record<string, string>): AgentRegistryPort {
	return {
		async fetchCard(url: string): Promise<any> {
			const r = responses[url];
			if (!r) return null;
			return {
				name: "stub",
				description: "",
				url,
				version: "1.0.0",
				capabilities: {},
				skills: [],
			};
		},
		async delegateTask(agentUrl: string, _text: string): Promise<string> {
			return responses[agentUrl] ?? "";
		},
	};
}

/** Build an AgentCard for a named agent with the given tags. */
function makeCard(name: string, tags: string[]): AgentCard {
	return {
		name,
		description: "",
		url: "",
		version: "1.0.0",
		capabilities: {},
		skills: [
			{
				name,
				description: "",
				tags,
				inputModes: ["text"],
				outputModes: ["text"],
			},
		],
	};
}

// ---- test ----

describe("OrchestratorAgent.executeWithDepth — %%HANDOVER%% end-to-end handover", () => {
	test("routes to Oracle, detects %%HANDOVER%%, delegates to the target agent, and returns the target's result at the parent task", async () => {
		const oracleUrl = "http://localhost:4101";
		const fixerUrl = "http://localhost:4102";
		const taskText = "review this code and fix the bug";

		// ToolRouter with explicit agent config — Oracle has a "review" tag so it
		// matches the "review this code" task text.
		const toolRouter = new ToolRouter({
			agents: {
				oracle: {
					name: "oracle",
					url: oracleUrl,
					card: makeCard("Oracle Agent", ["review"]),
				},
				fixer: {
					name: "fixer",
					url: fixerUrl,
					card: makeCard("Fixer Agent", ["fix"]),
				},
			},
			registry: makeRegistry({
				[oracleUrl]: encodeHandover({
					transferTo: "fixer",
					reason: "bug fix",
					context: taskText,
				}),
				[fixerUrl]: "Fixer agent processed the handover and applied the fix.",
			}),
			memory: noopMemory(),
		});

		const taskStore = makeTaskStore() as TaskStorePort & {
			tasks: Record<string, RecordedTask>;
		};
		const agent = new OrchestratorAgent(toolRouter, taskStore, noopMemory());

		const taskId = crypto.randomUUID();
		taskStore.create(taskId);

		await agent.execute(taskId, taskText);

		// 1. Parent lifecycle: submitted → working → completed.
		const parent = taskStore.tasks[taskId]!;
		expect(parent.state).toBe("completed");

		// 2. The parent's FINAL agent message is the child's result (fixer's text),
		//    not the oracle's %%HANDOVER%% trailer.
		const agentMessages = parent.messages.filter((m) => m.role === "agent");
		expect(agentMessages.length).toBeGreaterThanOrEqual(1);
		const lastAgentMsg = agentMessages[agentMessages.length - 1];
		const lastAgentText = lastAgentMsg.parts
			.filter((p) => p.kind === "text")
			.map((p) => p.text)
			.join("");
		expect(lastAgentText).not.toContain("%%HANDOVER%%");
		expect(lastAgentText).toBe(
			"Fixer agent processed the handover and applied the fix.",
		);

		// 3. A child task was created and completed.
		const childIds = Object.keys(taskStore.tasks).filter((id) => id !== taskId);
		expect(childIds.length).toBeGreaterThanOrEqual(1);
		const childId = childIds[0];
		const child = taskStore.tasks[childId]!;
		expect(child.state).toBe("completed");

		// 4. Child has user + agent messages; the agent message is fixer's response.
		expect(child.messages.some((m) => m.role === "user")).toBe(true);
		const childAgentMsg = child.messages.find((m) => m.role === "agent");
		expect(childAgentMsg).not.toBeUndefined();
		const childAgentText = childAgentMsg!.parts
			.filter((p) => p.kind === "text")
			.map((p) => p.text)
			.join("");
		expect(childAgentText).toBe(
			"Fixer agent processed the handover and applied the fix.",
		);
	});
});
