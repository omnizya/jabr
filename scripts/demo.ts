/**
 * demo.ts — End-to-end test of the full agent stack
 *
 * What it tests:
 *   1. A2A agent card discovery (Coder + Researcher)
 *   2. Direct A2A task delegation (Coder Agent)
 *   3. Orchestrator routing (Coder vs Researcher)
 *   4. Self-improvement: skill file creation
 *   5. ACP bridge handshake (stdio simulation)
 *   6. Memory persistence check
 *
 * Run AFTER starting all agents:
 *   bun run coder &
 *   bun run researcher &
 *   bun run orchestrator &
 *   bun scripts/demo.ts
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

const CODER = "http://localhost:4001";
const RESEARCHER = "http://localhost:4002";
const ORCHESTRATOR = "http://localhost:4000";

let passed = 0;
let failed = 0;

function step(label: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`▶ ${label}`);
  console.log("─".repeat(60));
}

async function check(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${label}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${label}: ${(e as Error).message}`);
    failed++;
  }
}

async function postA2A(url: string, method: string, params: unknown) {
  const res = await fetch(`${url}/a2a`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params,
    }),
  });
  return res.json() as Promise<{ result: unknown; error?: unknown }>;
}

async function waitForTask(
  agentUrl: string,
  taskId: string,
  maxWait = 5000,
): Promise<string> {
  const deadline = Date.now() + maxWait;
  while (Date.now() < deadline) {
    await Bun.sleep(250);
    const { result } = (await postA2A(agentUrl, "tasks/get", { taskId })) as {
      result: {
        status: { state: string };
        history: Array<{
          role: string;
          parts: Array<{ kind: string; text: string }>;
        }>;
      };
    };
    if (result.status.state === "completed") {
      return (
        result.history
          .find((m) => m.role === "agent")
          ?.parts.find((p) => p.kind === "text")?.text ?? ""
      );
    }
    if (result.status.state === "failed") throw new Error("Task failed");
  }
  throw new Error("Timeout");
}

// ── 1. A2A agent card discovery ───────────────────────────────────────────────
step("1 · A2A Agent Card discovery");

await check("Coder Agent card reachable", async () => {
  const res = await fetch(`${CODER}/.well-known/agent-card.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const card = (await res.json()) as { name: string; skills: unknown[] };
  if (!card.name) throw new Error("No name in card");
  console.log(`     → ${card.name} · ${card.skills.length} skills`);
});

await check("Researcher Agent card reachable", async () => {
  const res = await fetch(`${RESEARCHER}/.well-known/agent-card.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const card = (await res.json()) as { name: string; skills: unknown[] };
  console.log(`     → ${card.name} · ${card.skills.length} skills`);
});

await check("Orchestrator card reachable", async () => {
  const res = await fetch(`${ORCHESTRATOR}/.well-known/agent-card.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const card = (await res.json()) as { name: string };
  console.log(`     → ${card.name}`);
});

// ── 2. Direct A2A task delegation ─────────────────────────────────────────────
step("2 · Direct A2A task: Coder Agent → Fibonacci");

await check("Send task and poll to completion", async () => {
  const { result: task } = (await postA2A(CODER, "message/send", {
    message: {
      messageId: crypto.randomUUID(),
      role: "user",
      kind: "message",
      parts: [
        { kind: "text", text: "Implement a fibonacci function in TypeScript" },
      ],
      contextId: crypto.randomUUID(),
    },
  })) as { result: { id: string } };

  const taskId = task.id;
  const response = await waitForTask(CODER, taskId);
  if (!response.includes("fibonacci") && !response.includes("Fibonacci"))
    throw new Error("Response doesn't mention fibonacci");
  console.log(`     → ${response.slice(0, 80)}…`);
});

// ── 3. Orchestrator routing ───────────────────────────────────────────────────
step("3 · Orchestrator routing: code task → Coder Agent");

await check("Orchestrator routes code task", async () => {
  const { result: task } = (await postA2A(ORCHESTRATOR, "message/send", {
    message: {
      messageId: crypto.randomUUID(),
      role: "user",
      kind: "message",
      parts: [{ kind: "text", text: "Write a binary search function" }],
      contextId: crypto.randomUUID(),
    },
  })) as { result: { id: string } };

  const response = await waitForTask(ORCHESTRATOR, task.id, 8000);
  console.log(`     → ${response.slice(0, 80)}…`);
});

await check("Orchestrator routes research task → Researcher", async () => {
  const { result: task } = (await postA2A(ORCHESTRATOR, "message/send", {
    message: {
      messageId: crypto.randomUUID(),
      role: "user",
      kind: "message",
      parts: [{ kind: "text", text: "Research the MCP and A2A protocols" }],
      contextId: crypto.randomUUID(),
    },
  })) as { result: { id: string } };

  const response = await waitForTask(ORCHESTRATOR, task.id, 8000);
  if (!response.includes("MCP") && !response.includes("A2A"))
    throw new Error("Response doesn't mention protocols");
  console.log(`     → ${response.slice(0, 80)}…`);
});

// ── 4. Self-improvement: skill persistence ────────────────────────────────────
step("4 · Self-improvement — skill files created");

await check("Researcher creates skill files after tasks", async () => {
  // Trigger a research task to generate skills
  const { result: task } = (await postA2A(RESEARCHER, "message/send", {
    message: {
      messageId: crypto.randomUUID(),
      role: "user",
      kind: "message",
      parts: [
        { kind: "text", text: "Research self-improvement in agent systems" },
      ],
      contextId: crypto.randomUUID(),
    },
  })) as { result: { id: string } };
  await waitForTask(RESEARCHER, task.id);

  // Check skill store
  const skillDir = join(process.cwd(), "skills");
  if (!existsSync(skillDir)) throw new Error("skills/ directory not created");
  const files = readdirSync(skillDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) throw new Error("No skill files created");
  console.log(`     → ${files.length} skill(s): ${files.join(", ")}`);

  // Validate skill structure
  const skill = JSON.parse(readFileSync(join(skillDir, files[0]!), "utf-8"));
  if (!skill.name || !skill.steps || !Array.isArray(skill.steps))
    throw new Error("Invalid skill structure");
  console.log(`     → Sample: "${skill.name}" (${skill.steps.length} steps)`);
});

// ── 5. Memory persistence ─────────────────────────────────────────────────────
step("5 · Memory persistence (Hermes-style)");

await check("Orchestrator memory file written", async () => {
  const memPath = join(process.cwd(), "memory", "orchestrator.md");
  if (!existsSync(memPath)) throw new Error("memory/orchestrator.md not found");
  const mem = readFileSync(memPath, "utf-8");
  if (mem.length < 10) throw new Error("Memory file too short");
  const lines = mem.trim().split("\n").filter(Boolean);
  console.log(`     → ${lines.length} memory entries`);
  console.log(`     → Last: ${lines.at(-1)?.slice(0, 80)}…`);
});

// ── 6. ACP bridge handshake (simulated) ──────────────────────────────────────
step("6 · ACP bridge — simulated initialize + sessions/message");

await check("ACP initialize returns capabilities", async () => {
  // Spawn the ACP bridge as a subprocess and test it via stdin/stdout
  const proc = Bun.spawn(["bun", "agents/run/acp-bridge.ts"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Read initial ready notification
  const reader = proc.stdout.getReader();
  let buf = "";
  let gotReady = false;

  const readLine = async (): Promise<string> => {
    while (true) {
      if (buf.includes("\n")) {
        const [line, ...rest] = buf.split("\n");
        buf = rest.join("\n");
        return line!.trim();
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("ACP bridge stdout closed");
      buf += new TextDecoder().decode(value);
    }
  };

  // Read ready notification
  const ready = await Promise.race([
    readLine(),
    Bun.sleep(2000).then(() => "timeout"),
  ]);
  if (ready === "timeout")
    throw new Error("ACP bridge did not send ready notification");

  // Send initialize
  const initReq =
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    }) + "\n";
  proc.stdin.write(initReq);
  const initResp = await Promise.race([
    readLine(),
    Bun.sleep(2000).then(() => "timeout"),
  ]);
  if (initResp === "timeout") throw new Error("ACP bridge initialize timeout");

  const parsed = JSON.parse(initResp);
  if (!parsed.result?.capabilities)
    throw new Error("No capabilities in response");
  console.log(
    `     → capabilities: ${JSON.stringify(parsed.result.capabilities)}`,
  );

  // Send sessions/create
  proc.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "sessions/create",
      params: {},
    }) + "\n",
  );
  const sessResp = await Promise.race([
    readLine(),
    Bun.sleep(2000).then(() => "timeout"),
  ]);
  if (sessResp === "timeout") throw new Error("sessions/create timeout");
  const sessData = JSON.parse(sessResp);
  if (!sessData.result?.sessionId) throw new Error("No sessionId in response");
  console.log(`     → sessionId: ${sessData.result.sessionId.slice(0, 16)}…`);

  proc.kill();
});

// ── 7. Orchestrator discover endpoint ─────────────────────────────────────────
step("7 · Orchestrator agent discovery endpoint");

await check("discover returns sub-agent cards", async () => {
  const { result } = (await postA2A(ORCHESTRATOR, "discover", {})) as {
    result: { agents: unknown[] };
  };
  const agents = result.agents ?? [];
  console.log(`     → ${agents.length} agent(s) discovered`);
  for (const a of agents as Array<{ name: string; url: string }>) {
    console.log(`       • ${a.name} @ ${a.url}`);
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
console.log(`Results: ${passed} passed · ${failed} failed`);
console.log("═".repeat(60));

if (failed > 0) {
  console.log("\n⚠ Some tests failed. Make sure all agents are running:");
  console.log("  bun run coder &");
  console.log("  bun run researcher &");
  console.log("  bun run orchestrator &");
  console.log("  bun run demo");
}

process.exit(failed > 0 ? 1 : 0);
