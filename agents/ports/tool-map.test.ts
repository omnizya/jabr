// agents/ports/tool-map.test.ts
//
// Unit tests for the tool-name → handler map pattern.
// Verifies: correct handler dispatch for registered tools, unknown-tool error
// handling (both throwing and safe variants), handler-error wrapping, and
// that the map's external behavior matches the switch/case dispatch it replaces.

import { describe, expect, test } from "bun:test";
import type { McpToolResult } from "@ports/mcp-tool-port";
import {
	buildToolMap,
	dispatchTool,
	dispatchToolSafe,
	ToolExecutionError,
	type ToolNameMap,
	ToolNotFoundError,
} from "./tool-map";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function okResult(text: string): Promise<McpToolResult> {
	return { content: text };
}

async function errorResult(text: string): Promise<McpToolResult> {
	return { content: text, isError: true };
}

/**
 * Build a map with three known tools. Each handler records the arguments it
 * received so tests can assert that dispatch passes name + args correctly.
 */
type CallRecord = { toolName: string; args: Record<string, unknown> };

function makeThreeToolMap(): {
	map: ToolNameMap;
	calls: Record<"read_file" | "write_file" | "run_python", CallRecord[]>;
} {
	const calls: Record<"read_file" | "write_file" | "run_python", CallRecord[]> =
		{
			read_file: [],
			write_file: [],
			run_python: [],
		};

	const map = buildToolMap({
		read_file: (name, args) => {
			calls.read_file.push({ toolName: name, args });
			return okResult("read_file ok");
		},
		write_file: (name, args) => {
			calls.write_file.push({ toolName: name, args });
			return okResult("write_file ok");
		},
		run_python: (name, args) => {
			calls.run_python.push({ toolName: name, args });
			return okResult("run_python ok");
		},
	});

	return { map, calls };
}

// ---------------------------------------------------------------------------
// buildToolMap
// ---------------------------------------------------------------------------

describe("buildToolMap", () => {
	test("returns a map containing all provided entries", () => {
		const map = buildToolMap({
			foo: () => okResult("foo"),
			bar: () => okResult("bar"),
		});
		expect(typeof map["foo"]).toBe("function");
		expect(typeof map["bar"]).toBe("function");
	});

	test("later entries win on key collision", () => {
		const first = () => okResult("first");
		const second = () => okResult("second");
		const map = buildToolMap({ tool: first }, undefined);
		// Rebuild to test collision: buildToolMap only spreads once, so simulate
		// a caller passing two entries that share a key — spread lets the last
		// one win without a duplicate-key error.
		const collided = buildToolMap(
			{ ...{ tool: first }, ...{ tool: second } },
			undefined,
		);
		// The last one in source order wins.
		expect(collided["tool"]!).toBe(second);
	});

	test("stores the fallback under __fallback__", () => {
		const fb = () => okResult("fallback");
		const map = buildToolMap({ known: () => okResult("known") }, fb);
		expect(map["__fallback__"]).toBe(fb);
		expect(map["known"]).toBeDefined();
	});

	test("returns a map with no __fallback__ when omitted", () => {
		const map = buildToolMap({ known: () => okResult("known") });
		expect(map["__fallback__"]).toBeUndefined();
	});

	test("does not mutate the caller's entries object", () => {
		const entries = { a: () => okResult("a") };
		const before = Object.keys(entries).length;
		buildToolMap(entries, () => okResult("fb"));
		expect(Object.keys(entries).length).toBe(before);
		expect(entries).not.toHaveProperty("__fallback__");
	});
});

// ---------------------------------------------------------------------------
// dispatchTool — known tools
// ---------------------------------------------------------------------------

describe("dispatchTool — known tools", () => {
	test("routes to the correct handler for each registered tool", async () => {
		const { map, calls } = makeThreeToolMap();

		await dispatchTool(map, "read_file", { path: "/x" });
		await dispatchTool(map, "write_file", { path: "/y", content: "z" });
		await dispatchTool(map, "run_python", { code: "print(1)" });

		expect(calls.read_file).toEqual([
			{ toolName: "read_file", args: { path: "/x" } },
		]);
		expect(calls.write_file).toEqual([
			{ toolName: "write_file", args: { path: "/y", content: "z" } },
		]);
		expect(calls.run_python).toEqual([
			{ toolName: "run_python", args: { code: "print(1)" } },
		]);
	});

	test("returns the handler's McpToolResult unchanged", async () => {
		const map = buildToolMap({
			tool: () => okResult("custom"),
		});
		const result = await dispatchTool(map, "tool", {});
		expect(result).toEqual({ content: "custom" });
	});

	test("passes the tool name to the handler", async () => {
		let receivedName = "";
		const map = buildToolMap({
			my_tool: (name, _args) => {
				receivedName = name;
				return okResult("ok");
			},
		});
		await dispatchTool(map, "my_tool", {});
		expect(receivedName).toBe("my_tool");
	});

	test("passes the arguments object to the handler", async () => {
		let receivedArgs: Record<string, unknown> | undefined;
		const map = buildToolMap({
			my_tool: (_name, args) => {
				receivedArgs = args;
				return okResult("ok");
			},
		});
		const args = { key: "value", num: 42 };
		await dispatchTool(map, "my_tool", args);
		expect(receivedArgs).toEqual(args);
	});

	test("handler can return isError: true and dispatch passes it through", async () => {
		const map = buildToolMap({
			failing_tool: () => errorResult("handler error"),
		});
		const result = await dispatchTool(map, "failing_tool", {});
		expect(result).toEqual({ content: "handler error", isError: true });
	});

	test("handlers may be async and dispatch awaits them", async () => {
		const map = buildToolMap({
			slow: async () => {
				await new Promise((r) => setTimeout(r, 5));
				return okResult("slow ok");
			},
		});
		const result = await dispatchTool(map, "slow", {});
		expect(result).toEqual({ content: "slow ok" });
	});
});

// ---------------------------------------------------------------------------
// dispatchTool — unknown tools
// ---------------------------------------------------------------------------

describe("dispatchTool — unknown tools", () => {
	test("throws ToolNotFoundError when the tool is not registered and no fallback exists", async () => {
		const map = buildToolMap({ known: () => okResult("ok") });
		await expect(dispatchTool(map, "unknown_tool", {})).rejects.toThrow(
			ToolNotFoundError,
		);
	});

	test("ToolNotFoundError carries the tool name", async () => {
		const map = buildToolMap({});
		try {
			await dispatchTool(map, "nope", {});
			expect.unreachable("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(ToolNotFoundError);
			expect((e as ToolNotFoundError).toolName).toBe("nope");
			expect((e as Error).message).toContain('Tool not registered: "nope"');
		}
	});

	test("invokes the fallback for an unknown tool", async () => {
		let fallbackCalledWith:
			| { name: string; args: Record<string, unknown> }
			| undefined;
		const map = buildToolMap(
			{ known: () => okResult("known") },
			(name, args) => {
				fallbackCalledWith = { name, args };
				return errorResult(`fallback for ${name}`);
			},
		);
		const result = await dispatchTool(map, "unknown", { x: 1 });
		expect(fallbackCalledWith).toEqual({
			name: "unknown",
			args: { x: 1 },
		});
		expect(result).toEqual({
			content: "fallback for unknown",
			isError: true,
		});
	});

	test("does not invoke the fallback for a known tool", async () => {
		let fallbackCalled = false;
		const map = buildToolMap({ known: () => okResult("known") }, () => {
			fallbackCalled = true;
			return errorResult("should not happen");
		});
		await dispatchTool(map, "known", {});
		expect(fallbackCalled).toBe(false);
	});

	test("fallback receives unknown names even when map is otherwise empty", async () => {
		const map = buildToolMap({}, (name, _args) => {
			return okResult(`fb:${name}`);
		});
		const result = await dispatchTool(map, "anything", {});
		expect(result).toEqual({ content: "fb:anything" });
	});
});

// ---------------------------------------------------------------------------
// dispatchTool — handler errors
// ---------------------------------------------------------------------------

describe("dispatchTool — handler errors", () => {
	test("wraps a thrown Error into ToolExecutionError", async () => {
		const map = buildToolMap({
			boom: () => {
				throw new Error("handler boom");
			},
		});
		await expect(dispatchTool(map, "boom", {})).rejects.toThrow(
			ToolExecutionError,
		);
	});

	test("ToolExecutionError carries the tool name", async () => {
		const map = buildToolMap({
			boom: () => {
				throw new Error("handler boom");
			},
		});
		try {
			await dispatchTool(map, "boom", {});
			expect.unreachable("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(ToolExecutionError);
			expect((e as ToolExecutionError).toolName).toBe("boom");
		}
	});

	test("ToolExecutionError carries the original cause", async () => {
		const original = new Error("original cause");
		const map = buildToolMap({
			boom: () => {
				throw original;
			},
		});
		try {
			await dispatchTool(map, "boom", {});
			expect.unreachable("should have thrown");
		} catch (e) {
			expect((e as ToolExecutionError).cause).toBe(original);
		}
	});

	test("wraps a non-Error throw (e.g. a string) into ToolExecutionError", async () => {
		const map = buildToolMap({
			boom: () => {
				throw "string error";
			},
		});
		await expect(dispatchTool(map, "boom", {})).rejects.toThrow(
			ToolExecutionError,
		);
		try {
			await dispatchTool(map, "boom", {});
			expect.unreachable();
		} catch (e) {
			expect((e as ToolExecutionError).cause).toBe("string error");
		}
	});

	test("production handler errors surface the cause message, not the object", async () => {
		// Mirrors the dispatchToolSafe cause formatting path.
		const map = buildToolMap({
			boom: () => {
				throw new Error("real production error");
			},
		});
		try {
			await dispatchTool(map, "boom", {});
			expect.unreachable();
		} catch (e) {
			const te = e as ToolExecutionError;
			expect(te.message).toContain('Tool "boom" execution failed:');
			expect(te.message).toContain("real production error");
		}
	});
});

// ---------------------------------------------------------------------------
// dispatchToolSafe — never throws
// ---------------------------------------------------------------------------

describe("dispatchToolSafe — never throws", () => {
	test("returns a successful result for a known tool", async () => {
		const map = buildToolMap({
			tool: () => okResult("ok"),
		});
		const result = await dispatchToolSafe(map, "tool", {});
		expect(result).toEqual({ content: "ok" });
		expect(result.isError).toBeUndefined();
	});

	test("returns an error result for an unknown tool (no fallback)", async () => {
		const map = buildToolMap({});
		const result = await dispatchToolSafe(map, "ghost", {});
		expect(result).toEqual({
			content: "Unknown tool: ghost",
			isError: true,
		});
	});

	test("returns an error result when the fallback returns one", async () => {
		const map = buildToolMap({ known: () => okResult("ok") }, (name, _args) =>
			errorResult(`no such: ${name}`),
		);
		const result = await dispatchToolSafe(map, "missing", {});
		expect(result).toEqual({
			content: "no such: missing",
			isError: true,
		});
	});

	test("returns an error result when a handler throws", async () => {
		const map = buildToolMap({
			bad: () => {
				throw new Error("handler failed");
			},
		});
		const result = await dispatchToolSafe(map, "bad", {});
		expect(result).toEqual({
			content: 'Tool "bad" failed: handler failed',
			isError: true,
		});
	});

	test("returns an error result for non-Error handler throws", async () => {
		const map = buildToolMap({
			bad: () => {
				throw "raw string failure";
			},
		});
		const result = await dispatchToolSafe(map, "bad", {});
		expect(result.isError).toBe(true);
		expect(result.content).toContain("raw string failure");
	});

	test("never throws for any input combination", async () => {
		const map = buildToolMap({ ok_tool: () => okResult("ok") }, () =>
			errorResult("fb"),
		);

		// Known tool, unknown tool, handler that throws — none should throw.
		await dispatchToolSafe(map, "ok_tool", {});
		await dispatchToolSafe(map, "absent", {});
		await dispatchToolSafe(
			buildToolMap({
				thrower: () => {
					throw new Error("x");
				},
			}),
			"thrower",
			{},
		);
	});

	test("throws and safe variants agree on successful dispatch", async () => {
		// Each variant gets its own map so the handler is invoked exactly once
		// per variant — we are verifying the return shapes agree, not that the
		// same map is efficient when called twice.
		const { map: mapA, calls: callsA } = makeThreeToolMap();
		const { map: mapB } = makeThreeToolMap();

		const direct = await dispatchTool(mapA, "read_file", { path: "/a" });
		const safe = await dispatchToolSafe(mapB, "read_file", { path: "/a" });

		expect(direct).toEqual(safe);
		expect(callsA.read_file.length).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Multi-tool dispatch correctness
// ---------------------------------------------------------------------------

describe("multi-tool dispatch correctness", () => {
	test("dispatching different registered tools reaches their own handlers", async () => {
		const { map, calls } = makeThreeToolMap();

		await dispatchTool(map, "read_file", { path: "/a" });
		await dispatchTool(map, "run_python", { code: "1" });
		await dispatchTool(map, "write_file", { path: "/b", content: "x" });
		await dispatchTool(map, "read_file", { path: "/c" });

		// Each handler received exactly the calls intended for it.
		expect(calls.read_file).toHaveLength(2);
		expect(calls.run_python).toHaveLength(1);
		expect(calls.write_file).toHaveLength(1);

		expect(calls.read_file[0]).toEqual({
			toolName: "read_file",
			args: { path: "/a" },
		});
		expect(calls.read_file[1]).toEqual({
			toolName: "read_file",
			args: { path: "/c" },
		});
		expect(calls.run_python[0]).toEqual({
			toolName: "run_python",
			args: { code: "1" },
		});
		expect(calls.write_file[0]).toEqual({
			toolName: "write_file",
			args: { path: "/b", content: "x" },
		});
	});

	test("registering all tools from the audit (nine registered + two called)", async () => {
		// This documents the full tool set covered by the pattern: the nine tools
		// registered in mcp-servers/tools.ts plus the two names actually called at
		// runtime (read_file, run_python). Map construction is the same mechanism
		// regardless of count — this test confirms the map scales without a switch.
		const handler =
			(name: string) => async (_n: string, _a: Record<string, unknown>) =>
				okResult(name);

		const auditToolNames = [
			"read_file",
			"write_file",
			"install_python_dependency",
			"run_python",
			"elicit_payment",
			"elicit_url_auth",
			"calculate",
			"save_skill",
			"list_skills",
		] as const;

		const map = buildToolMap(
			Object.fromEntries(
				auditToolNames.map((n) => [n, handler(n)]),
			) as ToolNameMap,
		);

		for (const name of auditToolNames) {
			const result = await dispatchTool(map, name, {});
			expect(result).toEqual({ content: name });
		}
	});

	test("new tools can be added without touching dispatch logic", async () => {
		const base = buildToolMap({
			existing: () => okResult("existing"),
		});

		const extended = buildToolMap({
			existing: base["existing"]!,
			brand_new: () => okResult("brand_new"),
		});

		expect(await dispatchTool(extended, "existing", {})).toEqual({
			content: "existing",
		});
		expect(await dispatchTool(extended, "brand_new", {})).toEqual({
			content: "brand_new",
		});

		// Unknown still errors.
		await expect(dispatchTool(extended, "missing", {})).rejects.toBeInstanceOf(
			ToolNotFoundError,
		);
	});
});

// ---------------------------------------------------------------------------
// Behavior contract: map replaces switch/case, external shape is identical
// ---------------------------------------------------------------------------

describe("behavior contract — matches switch/case dispatch externally", () => {
	test("dispatchToolSafe produces the same error shape a switch default would", async () => {
		// A switch-based default path would return:
		//   { content: [{ type: "text", text: `Unknown tool: ${toolName}` }], isError: true }
		// The map's dispatchToolSafe returns the same information in McpToolResult
		// shape (content is a string per the port interface).
		const map = buildToolMap({});
		const result = await dispatchToolSafe(map, "mystery_tool", {});

		expect(result.isError).toBe(true);
		expect(result.content).toContain("Unknown tool:");
		expect(result.content).toContain("mystery_tool");
	});

	test("dispatchToolSafe produces the same error shape a handler catch would", async () => {
		// A switch-based handler that throws would be caught and returned as:
		//   { content: [{ type: "text", text: `Tool "X" failed: ...` }], isError: true }
		const map = buildToolMap({
			flaky: () => {
				throw new Error("network timeout");
			},
		});
		const result = await dispatchToolSafe(map, "flaky", {});

		expect(result.isError).toBe(true);
		expect(result.content).toContain('Tool "flaky" failed:');
		expect(result.content).toContain("network timeout");
	});

	test("known-tool success path is unaffected by the registry mechanism", async () => {
		const map = buildToolMap({
			tool_a: () => okResult("result A"),
			tool_b: () => okResult("result B"),
		});

		expect(await dispatchTool(map, "tool_a", {})).toEqual({
			content: "result A",
		});
		expect(await dispatchTool(map, "tool_b", {})).toEqual({
			content: "result B",
		});
	});

	test("dispatchTool and dispatchToolSafe diverge only on errors, not on success", async () => {
		const map = buildToolMap({
			good: () => okResult("good"),
		});

		// Both return the same value for a successful tool.
		const d = await dispatchTool(map, "good", {});
		const s = await dispatchToolSafe(map, "good", {});
		expect(d).toEqual(s);

		// dispatchTool throws on unknown; dispatchToolSafe returns an error result.
		await expect(dispatchTool(map, "missing", {})).rejects.toBeInstanceOf(
			ToolNotFoundError,
		);
		const safeMissing = await dispatchToolSafe(map, "missing", {});
		expect(safeMissing.isError).toBe(true);
	});
});
