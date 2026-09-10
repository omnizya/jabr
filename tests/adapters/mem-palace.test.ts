import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemPalaceAdapter } from "@adapters/mem-palace";

describe("MemPalaceAdapter — query optimization", () => {
	let dir: string;
	let palace: MemPalaceAdapter;

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), "mempalace-test-"));
		palace = new MemPalaceAdapter(dir);

		// Seed entries
		await palace.store(
			"react-hooks",
			"React Hooks let you use state and lifecycle in function components",
			["react", "hooks", "frontend"],
		);
		await palace.store(
			"postgres-indexing",
			"B-tree indexes speed up WHERE clauses and JOIN operations",
			["postgres", "database", "performance"],
		);
		await palace.store(
			"bun-runtime",
			"Bun is a fast JavaScript runtime with native bundling and testing",
			["bun", "javascript", "runtime"],
		);
		await palace.store(
			"tailwind-css",
			"Utility-first CSS framework for rapid UI development",
			["css", "tailwind", "frontend"],
		);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("query returns relevant results using indexed lookup", async () => {
		const results = await palace.query("react hooks state management", 2);
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].slug).toBe("react-hooks");
	});

	test("query scores tag matches higher", async () => {
		const results = await palace.query("database performance", 3);
		expect(results[0].slug).toBe("postgres-indexing");
	});

	test("query respects topK", async () => {
		const results = await palace.query("frontend css", 1);
		expect(results.length).toBe(1);
	});

	test("query returns empty for no matches", async () => {
		const results = await palace.query("quantum computing cryptography", 3);
		expect(results.length).toBe(0);
	});

	test("query after store uses updated data", async () => {
		await palace.store(
			"quantum-basics",
			"Quantum computing uses qubits for cryptographic applications",
			["quantum", "cryptography"],
		);
		const results = await palace.query("quantum computing", 3);
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].slug).toBe("quantum-basics");
	});

	test("query is consistent with multiple calls", async () => {
		const r1 = await palace.query("react frontend", 3);
		const r2 = await palace.query("react frontend", 3);
		expect(r1.map((e) => e.slug)).toEqual(r2.map((e) => e.slug));
	});

	test("list returns all entries", async () => {
		const all = await palace.list();
		expect(all.length).toBe(4);
	});

	test("get returns single entry", async () => {
		const entry = await palace.get("bun-runtime");
		expect(entry).not.toBeNull();
		expect(entry!.slug).toBe("bun-runtime");
	});

	test("relate adds bidirectional relations", async () => {
		await palace.relate("react-hooks", "tailwind-css", "used-with");
		const a = await palace.get("react-hooks");
		const b = await palace.get("tailwind-css");
		expect(a!.relations).toContain("used-with:tailwind-css");
		expect(b!.relations).toContain("inverse_used-with:react-hooks");
	});

	test("empty query returns first K entries", async () => {
		const results = await palace.query("", 2);
		expect(results.length).toBe(2);
	});
});
