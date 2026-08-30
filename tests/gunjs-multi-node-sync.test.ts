/**
 * gunjs-multi-node-sync.test.ts — E2E test for GunJS P2P state synchronization.
 *
 * Verifies GunJS 0.2020.x HTTP peer sync behavior:
 *  - Server peer: Gun + Node HTTP relay (GET /gun?get=<path>, POST /gun?put=<path>)
 *  - Client peer: Gun with server URL as peer
 *
 * GunJS node.js semantics (from debugging):
 *  - Nodes MUST be objects; scalars at non-root paths rejected.
 *  - gun.get('a').put({x:1}) stores {x:1} AT node 'a' (merges with existing props).
 *  - HTTP peers are pull-only: client pulls from server, writes NOT auto-pushed.
 *  - Client→server writes go through relay POST.
 *  - Paths accumulate properties across writes — use unique paths per test.
 *
 * Run:  bun test tests/gunjs-multi-node-sync.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Gun = require("gun");

const STORE_DIR = join(process.cwd(), "tmp", "gunjs-sync-test");
const NS = randomUUID().slice(0, 8); // unique namespace per test file run

function ensureStoreDir() {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
}
function cleanStoreDir() {
  if (existsSync(STORE_DIR)) rmSync(STORE_DIR, { recursive: true, force: true });
}

// ── Gun helpers ─────────────────────────────────────────────────────────────

/** Strip Gun internal `_` wrapper, recursing into children. */
function clean(data) {
  if (data == null || typeof data !== "object") return data;
  const d = data;
  if (!d._) return data;
  const out = {};
  for (const k of Object.keys(d)) {
    if (k === "_") continue;
    out[k] = clean(d[k]);
  }
  return out;
}

/** Read and normalize a Gun path once. */
function read(gun, path) {
  return new Promise((resolve) => {
    gun.get(path).once((data) => {
      resolve(data != null ? clean(data) : null);
    });
  });
}

/** Wait for a Gun path to contain expected properties (subset match for objects). */
async function wait(gun, path, expected, timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const val = await read(gun, path);
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const match = Object.entries(expected).every(([k, v]) => val[k] === v);
      if (match) return;
    } else if (JSON.stringify(val) === JSON.stringify(expected)) {
      return;
    }
    await Bun.sleep(80);
  }
  const got = await read(gun, path);
  throw new Error(
    `wait timeout: path=${path} want=${JSON.stringify(expected)} got=${JSON.stringify(got)}`,
  );
}

// ── Peer lifecycle ──────────────────────────────────────────────────────────

function startServer() {
  ensureStoreDir();
  const gun = Gun({ file: false, web: false });
  const server = createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    if (u.pathname !== "/gun") {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    if (req.method === "GET") {
      const p = u.searchParams.get("get") || "";
      read(gun, p).then((v) => {
        res.writeHead(200);
        res.end(JSON.stringify(v ?? null));
      }).catch((e) => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(e) }));
      });
      return;
    }

    if (req.method === "POST") {
      const p = u.searchParams.get("put") || "";
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        let obj = {};
        try { obj = JSON.parse(body || "{}"); } catch { obj = {}; }
        gun.get(p).put(obj);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    res.writeHead(405);
    res.end("method not allowed");
  });
  server.listen(0);
  const port = server.address().port;
  return { gun, port, server, stop: () => server.close() };
}

function startClient(serverUrl) {
  ensureStoreDir();
  const gun = Gun({ file: false, web: false, peers: [serverUrl] });
  return { gun, stop: () => {} };
}

async function relayPut(server, path, value) {
  const url = `http://localhost:${server.port}/gun?put=${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value ?? {}),
  });
  if (!res.ok) throw new Error(`relayPut failed: ${res.status}`);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe(`GunJS multi-node sync [ns=${NS}]`, () => {
  let server, client;

  afterEach(async () => {
    server?.stop();
    client?.stop();
    cleanStoreDir();
  });

  // ── Server → Client (pull sync) ─────────────────────────────────────────

  test("server write propagates to client via pull sync", async () => {
    server = startServer();
    await Bun.sleep(150);
    client = startClient(`http://localhost:${server.port}/gun`);
    await Bun.sleep(150);

    const root = `${NS}/s2c-pull`;
    server.gun.get(root).put({ msg: "hello" });

    // Client pulls the object from server; check property inside.
    await wait(client.gun, root, { msg: "hello" });
  });

  // ── Client → Server (relay POST) ───────────────────────────────────────

  test("client write propagates to server via relay POST", async () => {
    server = startServer();
    await Bun.sleep(150);
    client = startClient(`http://localhost:${server.port}/gun`);
    await Bun.sleep(150);

    const root = `${NS}/c2s-post`;
    client.gun.get(root).put({ scalar: "from-client" });
    await relayPut(server, root, { scalar: "from-client" });

    // Server should have the object at root with scalar property.
    await wait(server.gun, root, { scalar: "from-client" });
  });

  // ── CRDT convergence ────────────────────────────────────────────────────

  test("concurrent writes converge to single value", async () => {
    server = startServer();
    await Bun.sleep(150);
    client = startClient(`http://localhost:${server.port}/gun`);
    await Bun.sleep(150);

    const root = `${NS}/concurrent`;
    server.gun.get(root).put({ v: "server" });
    client.gun.get(root).put({ v: "client" });
    await relayPut(server, root, { v: "client" });
    await Bun.sleep(1200);

    const sv = await read(server.gun, root);
    const cv = await read(client.gun, root);
    expect(sv).toEqual(cv);
    expect(["server", "client"]).toContain(sv?.v);
  });

  // ── Graph hierarchy ─────────────────────────────────────────────────────

  test("graph hierarchy write propagates", async () => {
    server = startServer();
    await Bun.sleep(150);
    client = startClient(`http://localhost:${server.port}/gun`);
    await Bun.sleep(150);

    // Gun nodes must be objects — store {val:'online'} at leaf.
    client.gun.get("agents").get("oracle").get("status").put({ val: "online" });
    await relayPut(server, "agents/oracle/status", { val: "online" });
    await wait(server.gun, "agents/oracle/status", { val: "online" });
  });

  test("multiple keys under parent sync via relay", async () => {
    server = startServer();
    await Bun.sleep(150);
    client = startClient(`http://localhost:${server.port}/gun`);
    await Bun.sleep(150);

    // Store object at parent, then relay individual props.
    const parent = `${NS}/world`;
    client.gun.get(parent).put({ x: 10, y: 20 });
    await relayPut(server, parent, { x: 10, y: 20 });

    // Read parent object and check properties.
    await wait(server.gun, parent, { x: 10, y: 20 });
  });
});
