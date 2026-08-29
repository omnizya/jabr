/**
 * e2e-live.test.ts — Comprehensive end-to-end test suite for the LIVE Jabr A2A
 * agent ecosystem.
 *
 * Run against the running agents (ports 4000–4006 + jarvis 1337). Each test is
 * independent and resilient: network calls retry once on transient connection
 * errors, and every fetch carries an explicit AbortSignal timeout.
 *
 * NOTE: This suite is intentionally diagnostic. It is expected to surface
 * real regressions in the live system (e.g. broken delegation text, jarvis
 * returning "No response"). A failing test here is a *finding*, not a mistake
 * in the harness — the report maps each failure to its root cause.
 *
 * Run:  bun test tests/e2e-live.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorldState } from "@agents/types";

// ── Agent registry (seed keys ↔ ports) ────────────────────────────────────────
interface AgentSpec {
  key: string;
  port: number;
  cardName: string;
}
const AGENTS: AgentSpec[] = [
  { key: "orchestrator", port: 4000, cardName: "JABIR" },
  { key: "oracle", port: 4001, cardName: "RUSHD" },
  { key: "librarian", port: 4002, cardName: "FIHRIYA" },
  { key: "explorer", port: 4003, cardName: "BATTUTA" },
  { key: "designer", port: 4004, cardName: "FIRNAS" },
  { key: "fixer", port: 4005, cardName: "TARIQ" },
  { key: "scientist", port: 4006, cardName: "KHWARIZMI" },
  { key: "jarvis", port: 1337, cardName: "WAZIR" },
];
const SEED_AGENT_KEYS = [
  "oracle",
  "librarian",
  "explorer",
  "designer",
  "fixer",
  "scientist",
  "jarvis",
];

interface JsonRpcEnvelope {
  jsonrpc: string;
  id: number | string | null;
  result?: { text?: string };
  error?: { code: number; message: string };
}

// ── HTTP helpers (with one retry on transient network failure) ────────────────
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      lastErr = e;
      await Bun.sleep(400);
    }
  }
  throw lastErr;
}

/** POST a tasks/send (or other method) to an agent's root `/` endpoint. */
async function postA2A(
  port: number,
  text: string,
  method = "tasks/send",
  timeoutMs = 5000,
): Promise<{ status: number; envelope: JsonRpcEnvelope | null; raw: string }> {
  const res = await fetchWithTimeout(
    `http://localhost:${port}/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: { message: { parts: [{ kind: "text", text }] } },
      }),
    },
    timeoutMs,
  );
  const raw = await res.text();
  let envelope: JsonRpcEnvelope | null = null;
  try {
    envelope = JSON.parse(raw) as JsonRpcEnvelope;
  } catch {
    envelope = null;
  }
  return { status: res.status, envelope, raw };
}

async function getJson(
  url: string,
  timeoutMs = 5000,
): Promise<{ status: number; json: any; raw: string }> {
  const res = await fetchWithTimeout(url, { method: "GET" }, timeoutMs);
  const raw = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  return { status: res.status, json, raw };
}

// ── Minimal MCP stdio client (spawns `bun mcp-servers/tools.ts`) ──────────────
class McpStdioClient {
  private proc: ReturnType<typeof Bun.spawn>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buf = "";
  private nextId = 0;

  constructor() {
    this.proc = Bun.spawn(["bun", "mcp-servers/tools.ts"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
    });
    const stdout = this.proc.stdout as any;
    this.reader = stdout.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  }

  private async readMessage(): Promise<any> {
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl !== -1) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          return JSON.parse(trimmed);
        } catch {
          continue;
        }
      }
      const read = await Promise.race([
        this.reader.read(),
        Bun.sleep(10000).then(() => "timeout" as const),
      ]);
      if (read === "timeout") throw new Error("MCP read timeout");
      if (read.done) throw new Error("MCP stdout closed");
      this.buf += new TextDecoder().decode(read.value as Uint8Array);
    }
  }

  async call(method: string, params?: unknown, expectResponse = true): Promise<any> {
    const id = ++this.nextId;
    const msg: any = { jsonrpc: "2.0", method, params };
    if (expectResponse) msg.id = id;
    (this.proc.stdin as any).write(JSON.stringify(msg) + "\n");
    if (!expectResponse) return undefined;
    for (;;) {
      const m = await this.readMessage();
      if (m && m.id === id) return m;
    }
  }

  async init(): Promise<void> {
    await this.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "e2e-live-test", version: "1.0.0" },
    });
    await this.call("notifications/initialized", {}, false);
  }

  async calculate(
    expression: string,
  ): Promise<{ text?: string; isError?: boolean; error?: any }> {
    const res = await this.call("tools/call", {
      name: "calculate",
      arguments: { expression },
    });
    if (res.error) return { error: res.error };
    const result = res.result as any;
    return {
      text: result?.content?.[0]?.text,
      isError: result?.isError === true,
    };
  }

  close(): void {
    try {
      this.proc.kill();
    } catch {
      /* ignore */
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. PROTOCOL EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════
describe("1 · Protocol edge cases", () => {
  // 1a. Valid tasks/send → 200 + valid envelope, on every agent.
  for (const a of AGENTS) {
    const probeText: Record<string, string> = {
      orchestrator: "find files in the repo",
      oracle: "review this code",
      librarian: "research the mcp protocol",
      explorer: "find files",
      designer: "design a layout",
      fixer: "fix this bug",
      scientist: "analyze data with python",
      jarvis: "scan",
    };
    const timeout = a.key === "jarvis" ? 90000 : a.key === "oracle" || a.key === "librarian" || a.key === "scientist" ? 40000 : 15000;
    test(
      `[${a.key}] tasks/send → 200 + {jsonrpc,id,result:{text}}`,
      async () => {
        const { status, envelope } = await postA2A(a.port, probeText[a.key]!, "tasks/send", timeout);
        expect(status).toBe(200);
        expect(envelope).not.toBeNull();
        expect(envelope!.jsonrpc).toBe("2.0");
        expect(typeof envelope!.id).not.toBe("undefined");
        if (envelope!.error) {
          expect(typeof envelope!.error.code).toBe("number");
        } else {
          expect(typeof envelope!.result?.text).toBe("string");
        }
      },
      timeout + 5000,
    );
  }

  // 1b. Invalid method → -32601 (orchestrator + fixer).
  for (const a of [{ key: "orchestrator", port: 4000 }, { key: "fixer", port: 4005 }]) {
    for (const badMethod of ["tasks/get", "message/send", "bogus"]) {
      test(
        `[${a.key}] invalid method '${badMethod}' → -32601`,
        async () => {
          const { status, envelope } = await postA2A(a.port, "hello", badMethod, 8000);
          expect(status).toBe(200);
          expect(envelope?.error?.code).toBe(-32601);
        },
        12000,
      );
    }
  }

  // 1c. Wrong path → 404 (orchestrator + fixer).
  for (const a of [{ key: "orchestrator", port: 4000 }, { key: "fixer", port: 4005 }]) {
    for (const path of ["/a2a", "/foo"]) {
      test(
        `[${a.key}] POST ${path} → 404`,
        async () => {
          const res = await fetchWithTimeout(
            `http://localhost:${a.port}${path}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tasks/send", params: {} }),
            },
            8000,
          );
          expect(res.status).toBe(404);
        },
        12000,
      );
    }
  }

  // 1d. Malformed JSON body → graceful parse error (-32700), not a crash.
  for (const a of [{ key: "orchestrator", port: 4000 }, { key: "fixer", port: 4005 }]) {
    test(
      `[${a.key}] malformed JSON → -32700 (graceful)`,
      async () => {
        const res = await fetchWithTimeout(
          `http://localhost:${a.port}/`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "this is not json {{{",
          },
          8000,
        );
        expect(res.status).toBe(200);
        const env = (await res.json()) as JsonRpcEnvelope;
        expect(env.error?.code).toBe(-32700);
      },
      12000,
    );
  }

  // 1e. Missing message / parts / text → graceful (200 + valid envelope, no 500).
  for (const a of [{ key: "orchestrator", port: 4000 }, { key: "fixer", port: 4005 }]) {
    const variants: Array<[string, any]> = [
      ["missing params", { jsonrpc: "2.0", id: 1, method: "tasks/send" }],
      ["missing message", { jsonrpc: "2.0", id: 1, method: "tasks/send", params: {} }],
      ["missing parts", { jsonrpc: "2.0", id: 1, method: "tasks/send", params: { message: {} } }],
      ["empty parts", { jsonrpc: "2.0", id: 1, method: "tasks/send", params: { message: { parts: [] } } }],
    ];
    for (const [label, body] of variants) {
      test(
        `[${a.key}] ${label} → graceful (200, valid envelope)`,
        async () => {
          const res = await fetchWithTimeout(
            `http://localhost:${a.port}/`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
            45000,
          );
          expect(res.status).toBeLessThan(500);
          const txt = await res.text();
          let env: any = null;
          try {
            env = JSON.parse(txt);
          } catch {
            /* body may be non-JSON; still must not be a 500 */
          }
          if (env) {
            expect(env.jsonrpc).toBe("2.0");
            expect(env.result !== undefined || env.error !== undefined).toBe(true);
          }
        },
        50000,
      );
    }
  }

  // 1f. Agent Card discovery (every agent).
  for (const a of AGENTS) {
    test(
      `[${a.key}] GET /.well-known/agent-card.json → 200 + valid card`,
      async () => {
        const { status, json } = await getJson(`http://localhost:${a.port}/.well-known/agent-card.json`, 8000);
        expect(status).toBe(200);
        expect(typeof json?.name).toBe("string");
        expect(Array.isArray(json?.skills)).toBe(true);
        expect((json?.skills as unknown[]).length).toBeGreaterThan(0);
      },
      12000,
    );
  }

  // 1g. World-state endpoint on orchestrator.
  test("orchestrator GET /.well-known/world-state → 200 + fields", async () => {
    const { status, json } = await getJson("http://localhost:4000/.well-known/world-state", 8000);
    expect(status).toBe(200);
    expect(Array.isArray(json?.agents)).toBe(true);
    expect(json?.tasks).toBeDefined();
    expect(json?.skills).toBeDefined();
    expect(typeof json?.timestamp).toBe("string");
  }, 12000);
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. AGENT COMMAND RESPONSES (each specialist with its known command)
// ═════════════════════════════════════════════════════════════════════════════
describe("2 · Agent command responses", () => {
  const COMMANDS: Array<{ key: string; port: number; texts: string[]; timeout: number }> = [
    { key: "oracle", port: 4001, texts: ["review this code", "architecture decision"], timeout: 40000 },
    { key: "librarian", port: 4002, texts: ["research the better-auth library", "documentation for react"], timeout: 40000 },
    { key: "explorer", port: 4003, texts: ["find files named config", "map structure of the project"], timeout: 15000 },
    { key: "designer", port: 4004, texts: ["design a landing page layout", "color palette for a fintech app"], timeout: 15000 },
    { key: "fixer", port: 4005, texts: ["fix this bug in the parser", "implement a debounce function"], timeout: 15000 },
    { key: "scientist", port: 4006, texts: ["analyze data with python", "python script to sum a list"], timeout: 60000 },
    { key: "jarvis", port: 1337, texts: ["scan", "dependencies", "test gaps", "docs", "ai enhancements"], timeout: 90000 },
  ];

  for (const c of COMMANDS) {
    for (const text of c.texts) {
      test(
        `[${c.key}] "${text}" → non-empty, non-"No response"`,
        async () => {
          const { status, envelope } = await postA2A(c.port, text, "tasks/send", c.timeout);
          expect(status).toBe(200);
          const resultText = envelope?.result?.text ?? "";
          expect(resultText.length).toBeGreaterThan(0);
          expect(resultText).not.toBe("No response");
        },
        c.timeout + 5000,
      );
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. ORCHESTRATOR ROUTING (port 4000)
// ═════════════════════════════════════════════════════════════════════════════
describe("3 · Orchestrator routing", () => {
  // Rich markers = the response the agent produces ONLY when it actually received
  // the (non-empty) task text. If delegation passes empty text, the agent returns
  // its generic fallback, which will NOT match these markers — surfacing the bug.
  const ROUTES: Array<{
    text: string;
    agent: string;
    marker: RegExp;
    expectOracleFallback?: boolean;
  }> = [
    { text: "fix this bug in the code", agent: "fixer", marker: /Bug fix analysis|Fix applied/i },
    { text: "find all TODO comments", agent: "explorer", marker: /## (File Discovery|Project Map|Code Search)/i },
    { text: "research the better-auth library", agent: "librarian", marker: /## (Docs Lookup|Protocol Research)/i },
    { text: "design a landing page layout", agent: "designer", marker: /## (Layout Design|Component Design|Style Guide)/i },
    { text: "review this architecture", agent: "oracle", marker: /## (Code Review|Architecture Analysis|Simplification)/i, expectOracleFallback: true },
    { text: "analyze this data with python", agent: "scientist", marker: /Scientist executed analysis|Scientist failed to execute/i },
    { text: "scan the codebase for improvements", agent: "jarvis", marker: /\[Jarvis\] Steward scan complete/i },
  ];

  for (const r of ROUTES) {
    test(
      `routes "${r.text}" → ${r.agent}`,
      async () => {
        const { status, envelope } = await postA2A(4000, r.text, "tasks/send", 60000);
        expect(status).toBe(200);
        const resultText = envelope?.result?.text ?? "";
        expect(resultText.length).toBeGreaterThan(0);
        expect(resultText).not.toBe("No response");
        if (!r.expectOracleFallback) {
          expect(resultText).not.toMatch(/Oracle analyzed/i);
        }
        expect(resultText).toMatch(r.marker);
      },
      65000,
    );
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. HANDOVER CHAIN (orchestrator → oracle → fixer)
// ═════════════════════════════════════════════════════════════════════════════
describe("4 · Handover chain", () => {
  test(
    `"review this code and fix the bug in it" → final result from fixer (not oracle)`,
    async () => {
      const { status, envelope } = await postA2A(
        4000,
        "review this code and fix the bug in it",
        "tasks/send",
        60000,
      );
      expect(status).toBe(200);
      const resultText = envelope?.result?.text ?? "";
      expect(resultText.length).toBeGreaterThan(0);
      expect(resultText).not.toBe("No response");
      expect(resultText).not.toMatch(/Oracle analyzed/i);
      expect(resultText).toMatch(/Bug fix analysis|Fix applied|Fixer agent processed/i);
    },
    65000,
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. WORLD-STATE CORRECTNESS (orchestrator 4000)
// ═════════════════════════════════════════════════════════════════════════════
describe("5 · World-state correctness", () => {
  test("agents contains all 7 seed agents; tasks/skills/timestamp valid", async () => {
    // Ensure at least one task exists in sqlite before checking counts.
    await postA2A(4000, "find files", "tasks/send", 15000);

    const { status, json } = await getJson("http://localhost:4000/.well-known/world-state", 8000);
    expect(status).toBe(200);
    const ws = json as WorldState;

    const agentNames = (ws.agents ?? []).map((a: any) => a.name);
    for (const seed of SEED_AGENT_KEYS) {
      expect(agentNames).toContain(seed);
    }

    const t = ws.tasks as any;
    expect(typeof t?.total).toBe("number");
    expect(t.total).toBeGreaterThanOrEqual(0);
    const sum =
      (t.active ?? 0) + (t.completed ?? 0) + (t.failed ?? 0) + (t.canceled ?? 0);
    expect(t.total).toBe(sum);

    expect(typeof ws.skills?.total).toBe("number");

    expect(Number.isNaN(Date.parse(ws.timestamp))).toBe(false);
    expect(new Date(ws.timestamp).toISOString()).toBe(ws.timestamp);
  }, 25000);

  test("regression: tasks.total reflects real sqlite counts (not always 0)", async () => {
    const { json } = await getJson("http://localhost:4000/.well-known/world-state", 8000);
    const t = json?.tasks as any;
    expect(t?.total).toBeGreaterThan(0);
  }, 12000);
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. MCP TOOL SERVER (spawn `bun mcp-servers/tools.ts` over stdio)
// ═════════════════════════════════════════════════════════════════════════════
describe("6 · MCP tool server (calculate)", () => {
  let client: McpStdioClient | null = null;
  beforeAll(async () => {
    try {
      client = new McpStdioClient();
      await client.init();
    } catch (e) {
      client = null;
      console.warn("[MCP] spawn/init failed:", String(e));
    }
  });
  afterAll(() => client?.close());

  const cases: Array<{ expr: string; expect: "value" | "error"; value?: string }> = [
    { expr: "2+3*4", expect: "value", value: "14" },
    { expr: "(2+3)*4", expect: "value", value: "20" },
    { expr: "2^10", expect: "value", value: "1024" },
    { expr: "10/4", expect: "value", value: "2.5" },
    { expr: "10/0", expect: "error" },
    { expr: "process.exit()", expect: "error" },
  ];

  for (const c of cases) {
    test(
      `calculate("${c.expr}") → ${c.expect === "error" ? "ERROR (rejected)" : c.value}`,
      async () => {
        if (!client) throw new Error("MCP server unavailable — could not spawn");
        const r = await client.calculate(c.expr);
        if (c.expect === "error") {
          const rejected = r.isError === true || r.error != null || /unsafe|division by zero|zero/i.test(r.text ?? "");
          expect(rejected).toBe(true);
        } else {
          expect(r.isError).not.toBe(true);
          expect(r.error).toBeUndefined();
          expect(r.text).toBe(c.value);
        }
      },
      20000,
    );
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. REGRESSION CHECKS
// ═════════════════════════════════════════════════════════════════════════════
describe("7 · Regression checks", () => {
  test("demo.ts A2A contract is clean (no /a2a, message/send, tasks/get, waitForTask)", () => {
    const src = readFileSync(join(process.cwd(), "scripts/demo.ts"), "utf-8");
    expect(src).not.toMatch(/\/a2a/);
    expect(src).not.toMatch(/message\/send/);
    expect(src).not.toMatch(/tasks\/get/);
    expect(src).not.toMatch(/waitForTask/);
  });

  test("jarvis 'scan' returns a real result (regression: not 'No response')", async () => {
    const { status, envelope } = await postA2A(1337, "scan", "tasks/send", 90000);
    expect(status).toBe(200);
    const resultText = envelope?.result?.text ?? "";
    expect(resultText.length).toBeGreaterThan(0);
    expect(resultText).not.toBe("No response");
    expect(resultText).toMatch(/\[Jarvis\]/);
  }, 95000);

  test("delegation integrity: orchestrator passes the REAL task text to specialists", async () => {
    // Fixer echoes the received text in "Fixer agent processed: \"<text>\"". If
    // delegation strips the text (e.g. wrong part shape), the echo is empty.
    const { status, envelope } = await postA2A(4000, "fix this bug in the code", "tasks/send", 60000);
    expect(status).toBe(200);
    const resultText = envelope?.result?.text ?? "";
    expect(resultText).toMatch(/fix this bug in the code/);
  }, 65000);
});
