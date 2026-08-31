/**
 * t_088e8abb — Fixer agent login flow test (LLM enabled)
 * Input: "fix the login flow bug"
 * Expected: LLM-generated response (NOT canned keyword matcher fallback)
 */

import { HeadroomAdapter } from "@adapters/headroom";
import { NineRouterLlmAdapter } from "@adapters/llm/9router";
import { SkillFS } from "@adapters/skill-fs";
import { TaskMemory } from "@adapters/task-memory";
import { FIXER_CARD, FixerAgent } from "@core/fixer";
import type { SkillStorePort } from "@ports/skill-store";
import type { TaskStorePort } from "@ports/task-store";

const INPUT = "fix the login flow bug";

// Canned output from the bug-fix branch of executeTask() — the fallback
// we must NOT see when LLM is enabled and working.
const CANNED_TEXT = `Bug fix analysis for: "${INPUT}"

1. Reproduce the failing behavior
2. Locate the root cause
3. Apply a minimal, targeted fix
4. Verify with a test

Fix applied — review the diff and run the test suite.`;

function lastAgentText(store: TaskStorePort, taskId: string): string {
	const task = store.get(taskId);
	const last = task?.messages.filter((m) => m.role === "agent").pop();
	return last?.parts.find((p) => p.kind === "text")?.text ?? "";
}

async function runTest(): Promise<{ pass: boolean; logs: string[] }> {
	const logs: string[] = [];
	let pass = true;

	logs.push("=== Fixer Agent E2E Test (LLM enabled) ===");
	logs.push(`Input: "${INPUT}"`);
	logs.push(`Agent: ${FIXER_CARD.name} (${FIXER_CARD.description})`);
	logs.push("");

	// 1. Wire dependencies WITH LLM
	const taskStore: TaskStorePort = new TaskMemory();
	const skillStore: SkillStorePort = new SkillFS();
	const budget = new HeadroomAdapter();
	const llm = new NineRouterLlmAdapter(budget);
	const agent = new FixerAgent(taskStore, skillStore, llm);
	logs.push(
		"[1] Agent constructed with TaskMemory + SkillFS + NineRouterLlmAdapter",
	);

	// 2. Create task + execute
	const taskId = crypto.randomUUID();
	taskStore.create(taskId);
	logs.push(`[2] Task created: ${taskId}`);

	let execError: Error | null = null;
	let response = "";
	try {
		// Use synchronous executeTask path via the async execute wrapper
		await agent.execute(taskId, INPUT);
		logs.push("[3] execute() completed");
		response = lastAgentText(taskStore, taskId);
	} catch (e) {
		execError = e as Error;
		pass = false;
		logs.push(`[3] EXECUTION ERROR: ${e}`);
	}

	// 3. Capture response
	logs.push("");
	logs.push("=== Agent Response ===");
	logs.push(response);
	logs.push("");

	// 4. Verify zero runtime errors
	if (execError) {
		logs.push(`FAIL: runtime error occurred: ${execError.message}`);
		pass = false;
	} else {
		logs.push("PASS: zero runtime errors");
	}

	// 5. Verify response is NOT the canned keyword matcher output
	if (response === CANNED_TEXT) {
		pass = false;
		logs.push(
			"FAIL: response IS the canned keyword matcher output (LLM was not used)",
		);
	} else if (response.length === 0) {
		pass = false;
		logs.push("FAIL: response is empty");
	} else {
		logs.push(
			"PASS: response is NOT the canned keyword matcher output (LLM-generated)",
		);
	}

	// 6. Verify task state transitions
	const task = taskStore.get(taskId);
	const transitions = taskStore.getTransitionHistory(taskId);
	logs.push("");
	logs.push("=== Task State Transitions ===");
	for (const t of transitions) {
		logs.push(`  ${t.from} → ${t.to} @ ${t.timestamp}`);
	}
	logs.push(`Final state: ${task?.state ?? "unknown"}`);
	if (task?.state === "completed") {
		logs.push("PASS: task reached 'completed' state");
	} else {
		pass = false;
		logs.push(`FAIL: task state is '${task?.state}', expected 'completed'`);
	}

	// 7. Verify no artifacts (bug-fix branch returns no artifact)
	const artifactCount = task?.artifacts.length ?? 0;
	logs.push("");
	logs.push(`Artifacts: ${artifactCount}`);
	if (artifactCount === 0) {
		logs.push("PASS: no artifacts (bug-fix branch returns none)");
	} else {
		pass = false;
		logs.push(`FAIL: expected 0 artifacts, got ${artifactCount}`);
	}

	logs.push("");
	logs.push(pass ? "=== RESULT: PASS ===" : "=== RESULT: FAIL ===");

	return { pass, logs };
}

const result = await runTest();
for (const line of result.logs) {
	console.log(line);
}
if (!result.pass) process.exit(1);
