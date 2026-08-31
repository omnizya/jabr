/**
 * api-key-registry.test.ts — Tests for the ApiKeyRegistry and ACL enforcement.
 */

import { describe, expect, test } from "bun:test";
import { ApiKeyRegistry } from "@security/api-key-registry";

describe("ApiKeyRegistry", () => {
	const entries = [
		{
			key: "full-access-key",
			description: "admin",
			allowedAgents: [],
			enabled: true,
		},
		{
			key: "jarvis-only-key",
			description: "jarvis-caller",
			allowedAgents: ["jarvis"],
			enabled: true,
		},
		{
			key: "multi-agent-key",
			description: "multi-caller",
			allowedAgents: ["oracle", "librarian"],
			enabled: true,
		},
		{
			key: "disabled-key",
			description: "disabled-caller",
			allowedAgents: [],
			enabled: false,
		},
	];

	const registry = new ApiKeyRegistry(entries);

	test("authenticates valid wildcard key", () => {
		const caller = registry.authenticate("full-access-key");
		expect(caller).not.toBeNull();
		expect(caller!.description).toBe("admin");
		expect(caller!.allowedAgents).toEqual([]);
	});

	test("authenticates valid restricted key", () => {
		const caller = registry.authenticate("jarvis-only-key");
		expect(caller).not.toBeNull();
		expect(caller!.description).toBe("jarvis-caller");
		expect(caller!.allowedAgents).toEqual(["jarvis"]);
	});

	test("rejects unknown key", () => {
		expect(registry.authenticate("unknown-key")).toBeNull();
	});

	test("rejects null key", () => {
		expect(registry.authenticate(null)).toBeNull();
	});

	test("rejects disabled key", () => {
		expect(registry.authenticate("disabled-key")).toBeNull();
	});

	test("wildcard key can invoke any agent", () => {
		const caller = registry.authenticate("full-access-key")!;
		expect(registry.canInvoke(caller, "jarvis")).toBe(true);
		expect(registry.canInvoke(caller, "oracle")).toBe(true);
		expect(registry.canInvoke(caller, "nonexistent")).toBe(true);
	});

	test("restricted key can invoke allowed agent", () => {
		const caller = registry.authenticate("jarvis-only-key")!;
		expect(registry.canInvoke(caller, "jarvis")).toBe(true);
	});

	test("restricted key cannot invoke disallowed agent", () => {
		const caller = registry.authenticate("jarvis-only-key")!;
		expect(registry.canInvoke(caller, "oracle")).toBe(false);
	});

	test("multi-agent key allows only listed agents", () => {
		const caller = registry.authenticate("multi-agent-key")!;
		expect(registry.canInvoke(caller, "oracle")).toBe(true);
		expect(registry.canInvoke(caller, "librarian")).toBe(true);
		expect(registry.canInvoke(caller, "jarvis")).toBe(false);
	});

	test("throws on empty key in entry", () => {
		expect(
			() =>
				new ApiKeyRegistry([
					{ key: "", description: "bad", allowedAgents: [] },
				]),
		).toThrow();
	});
});
