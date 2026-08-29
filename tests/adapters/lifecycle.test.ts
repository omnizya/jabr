import { describe, expect, test } from "bun:test";
import { initLifecycle } from "@run/lifecycle";
import type { RealtimePort } from "@ports/realtime-port";

describe("initLifecycle", () => {
  test("announceOnline emits agent:online with agent name and optional port", () => {
    const emitted: Array<{ type: string; agent?: string; error?: string; port?: number }> = [];
    const realtime: RealtimePort = {
      broadcast: (event) =>
        emitted.push({
          type: event.type as string,
          agent: "agent" in event ? (event as { agent: string }).agent : undefined,
          error: "error" in event ? (event as { error: string }).error : undefined,
          port: "port" in event ? (event as { port: number }).port : undefined,
        }),
      emitTo: () => {},
      on: () => {},
      getConnectionCount: () => 0,
    };

    const lifecycle = initLifecycle(realtime, "oracle", 4001);
    lifecycle.announceOnline();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: "agent:online", agent: "oracle", port: 4001 });
  });

  test("announceOnline omits port when not provided", () => {
    const emitted: Array<{ type: string; agent?: string; error?: string }> = [];
    const realtime: RealtimePort = {
      broadcast: (event) =>
        emitted.push({
          type: event.type as string,
          agent: "agent" in event ? (event as { agent: string }).agent : undefined,
          error: "error" in event ? (event as { error: string }).error : undefined,
        }),
      emitTo: () => {},
      on: () => {},
      getConnectionCount: () => 0,
    };

    const lifecycle = initLifecycle(realtime, "scientist");
    lifecycle.announceOnline();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: "agent:online", agent: "scientist" });
    expect(emitted[0]).not.toHaveProperty("port");
  });

  test("uncaughtHandler emits agent:error with stringified error", () => {
    const emitted: Array<{ type: string; agent?: string; error?: string }> = [];
    const realtime: RealtimePort = {
      broadcast: (event) =>
        emitted.push({
          type: event.type as string,
          agent: "agent" in event ? (event as { agent: string }).agent : undefined,
          error: "error" in event ? (event as { error: string }).error : undefined,
        }),
      emitTo: () => {},
      on: () => {},
      getConnectionCount: () => 0,
    };

    const lifecycle = initLifecycle(realtime, "fixer");
    lifecycle.uncaughtHandler(new Error("boom"));

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: "agent:error", agent: "fixer", error: "Error: boom" });
  });

  test("uncaughtHandler stringifies non-Error values", () => {
    const emitted: Array<{ type: string; agent?: string; error?: string }> = [];
    const realtime: RealtimePort = {
      broadcast: (event) =>
        emitted.push({
          type: event.type as string,
          agent: "agent" in event ? (event as { agent: string }).agent : undefined,
          error: "error" in event ? (event as { error: string }).error : undefined,
        }),
      emitTo: () => {},
      on: () => {},
      getConnectionCount: () => 0,
    };

    const lifecycle = initLifecycle(realtime, "jarvis");
    lifecycle.uncaughtHandler("plain string");

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: "agent:error", agent: "jarvis", error: "plain string" });
  });
});
