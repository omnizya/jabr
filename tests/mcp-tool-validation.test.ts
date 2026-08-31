/**
 * mcp-tool-validation.test.ts — Tests for MCP tool input input validation.
 *
 * Verifies that:
 *   1. Unknown keys are rejected (strict mode)
 *   2. String length caps are enforced
 *   3. Path traversal is blocked
 *   4. Number bounds are enforced
 *   5. Array length bounds are enforced
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
	boundedNumber,
	cappedString,
	safePath,
	strictObject,
} from "../mcp-servers/validation.ts";

// ---------------------------------------------------------------------------
// strictObject — rejects unknown keys
// ---------------------------------------------------------------------------

describe("strictObject — rejects unknown keys", () => {
	const schema = strictObject({
		name: z.string(),
		age: z.number(),
	});

	test("accepts valid input", () => {
		const result = schema.safeParse({ name: "Alice", age: 30 });
		expect(result.success).toBe(true);
	});

	test("rejects unknown keys", () => {
		const result = schema.safeParse({ name: "Alice", age: 30, extra: "bad" });
		expect(result.success).toBe(false);
		if (!result.success) {
			const issue = result.error.issues[0];
			expect(issue.message.toLowerCase()).toContain("unrecognized");
		}
	});

	test("rejects __proto__ injection", () => {
		const result = schema.safeParse({
			name: "Alice",
			age: 30,
			__proto__: { polluted: true },
		});
		expect(result.success).toBe(false);
	});

	test("rejects constructor injection", () => {
		const result = schema.safeParse({
			name: "Alice",
			age: 30,
			constructor: { polluted: true },
		});
		expect(result.success).toBe(false);
	});

	test("rejects toString injection", () => {
		const result = schema.safeParse({
			name: "Alice",
			age: 30,
			toString: "bad",
		});
		expect(result.success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// cappedString — enforces max length
// ---------------------------------------------------------------------------

describe("cappedString — enforces max length", () => {
	const schema = cappedString(10, "A short string");

	test("accepts string within limit", () => {
		const result = schema.safeParse("hello");
		expect(result.success).toBe(true);
	});

	test("accepts string at exact limit", () => {
		const result = schema.safeParse("a".repeat(10));
		expect(result.success).toBe(true);
	});

	test("rejects string exceeding limit", () => {
		const result = schema.safeParse("a".repeat(11));
		expect(result.success).toBe(false);
		if (!result.success) {
			const issue = result.error.issues[0];
			expect(issue.message).toContain("10");
		}
	});

	test("rejects non-string input", () => {
		const result = schema.safeParse(123);
		expect(result.success).toBe(false);
	});

	test("rejects null input", () => {
		const result = schema.safeParse(null);
		expect(result.success).toBe(false);
	});

	test("rejects undefined input", () => {
		const result = schema.safeParse(undefined);
		expect(result.success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// safePath — blocks traversal
// ---------------------------------------------------------------------------

describe("safePath — blocks traversal", () => {
	const schema = safePath("A relative path");

	test("accepts simple relative path", () => {
		const result = schema.safeParse("src/index.ts");
		expect(result.success).toBe(true);
	});

	test("accepts single filename", () => {
		const result = schema.safeParse("package.json");
		expect(result.success).toBe(true);
	});

	test("rejects absolute path", () => {
		const result = schema.safeParse("/etc/passwd");
		expect(result.success).toBe(false);
		if (!result.success) {
			const issue = result.error.issues[0];
			expect(issue.message).toContain("absolute");
		}
	});

	test("rejects path traversal with ..", () => {
		const result = schema.safeParse("../../etc/passwd");
		expect(result.success).toBe(false);
		if (!result.success) {
			const issue = result.error.issues[0];
			expect(issue.message).toContain("..");
		}
	});

	test("rejects path traversal in middle", () => {
		const result = schema.safeParse("src/../../etc/passwd");
		expect(result.success).toBe(false);
	});

	test("rejects home expansion", () => {
		const result = schema.safeParse("~/.ssh/id_rsa");
		expect(result.success).toBe(false);
		if (!result.success) {
			const issue = result.error.issues[0];
			expect(issue.message).toContain("~");
		}
	});

	test("rejects path exceeding 500 chars", () => {
		const result = schema.safeParse("a".repeat(501));
		expect(result.success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// boundedNumber — enforces min/max
// ---------------------------------------------------------------------------

describe("boundedNumber — enforces min/max", () => {
	const schema = boundedNumber(0, 100, "A percentage");

	test("accepts number within range", () => {
		const result = schema.safeParse(50);
		expect(result.success).toBe(true);
	});

	test("accepts number at min boundary", () => {
		const result = schema.safeParse(0);
		expect(result.success).toBe(true);
	});

	test("accepts number at max boundary", () => {
		const result = schema.safeParse(100);
		expect(result.success).toBe(true);
	});

	test("rejects number below min", () => {
		const result = schema.safeParse(-1);
		expect(result.success).toBe(false);
	});

	test("rejects number above max", () => {
		const result = schema.safeParse(101);
		expect(result.success).toBe(false);
	});

	test("rejects non-number input", () => {
		const result = schema.safeParse("50");
		expect(result.success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Integration: strictObject with cappedString and safePath
// ---------------------------------------------------------------------------

describe("Integration — strictObject with cappedString and safePath", () => {
	const readSchema = strictObject({
		path: safePath("Relative file path"),
	});

	const writeSchema = strictObject({
		path: safePath("Relative file path"),
		content: cappedString(10000, "File content"),
	});

	test("read_file: rejects traversal", () => {
		const result = readSchema.safeParse({ path: "../../etc/passwd" });
		expect(result.success).toBe(false);
	});

	test("read_file: rejects unknown keys", () => {
		const result = readSchema.safeParse({ path: "src/index.ts", extra: "bad" });
		expect(result.success).toBe(false);
	});

	test("write_file: rejects content exceeding 10000 chars", () => {
		const result = writeSchema.safeParse({
			path: "src/index.ts",
			content: "a".repeat(10001),
		});
		expect(result.success).toBe(false);
	});

	test("write_file: accepts valid input", () => {
		const result = writeSchema.safeParse({
			path: "src/index.ts",
			content: "hello",
		});
		expect(result.success).toBe(true);
	});

	test("write_file: rejects unknown keys", () => {
		const result = writeSchema.safeParse({
			path: "src/index.ts",
			content: "hello",
			extra: "bad",
		});
		expect(result.success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Integration: save_skill schema
// ---------------------------------------------------------------------------

describe("Integration — save_skill schema", () => {
	const schema = strictObject({
		name: cappedString(100, "Skill name"),
		description: cappedString(500, "Skill description"),
		steps: z.array(cappedString(500, "Step instruction")).max(50),
		tags: z.array(cappedString(50, "Tag")).max(20).optional().default([]),
	});

	test("accepts valid input", () => {
		const result = schema.safeParse({
			name: "my-skill",
			description: "A test skill",
			steps: ["step 1", "step 2"],
			tags: ["test"],
		});
		expect(result.success).toBe(true);
	});

	test("rejects name exceeding 100 chars", () => {
		const result = schema.safeParse({
			name: "a".repeat(101),
			description: "A test skill",
			steps: ["step 1"],
		});
		expect(result.success).toBe(false);
	});

	test("rejects steps exceeding 50 items", () => {
		const result = schema.safeParse({
			name: "my-skill",
			description: "A test skill",
			steps: Array.from({ length: 51 }, (_, i) => `step ${i}`),
		});
		expect(result.success).toBe(false);
	});

	test("rejects tags exceeding 20 items", () => {
		const result = schema.safeParse({
			name: "my-skill",
			description: "A test skill",
			steps: ["step 1"],
			tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`),
		});
		expect(result.success).toBe(false);
	});

	test("rejects unknown keys", () => {
		const result = schema.safeParse({
			name: "my-skill",
			description: "A test skill",
			steps: ["step 1"],
			extra: "bad",
		});
		expect(result.success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Integration: calculate schema
// ---------------------------------------------------------------------------

describe("Integration — calculate schema", () => {
	const schema = strictObject({
		expression: cappedString(500, "Math expression"),
	});

	test("accepts valid expression", () => {
		const result = schema.safeParse({ expression: "1 + 2" });
		expect(result.success).toBe(true);
	});

	test("rejects expression exceeding 500 chars", () => {
		const result = schema.safeParse({ expression: "1+".repeat(250) + "1" });
		expect(result.success).toBe(false);
	});

	test("rejects unknown keys", () => {
		const result = schema.safeParse({ expression: "1 + 2", extra: "bad" });
		expect(result.success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Integration: elicit_payment schema
// ---------------------------------------------------------------------------

describe("Integration — elicit_payment schema", () => {
	const schema = strictObject({
		amount: boundedNumber(0, 1_000_000, "Amount in USD"),
		recipient: cappedString(200, "Payee name"),
	});

	test("accepts valid input", () => {
		const result = schema.safeParse({ amount: 100, recipient: "Alice" });
		expect(result.success).toBe(true);
	});

	test("rejects negative amount", () => {
		const result = schema.safeParse({ amount: -1, recipient: "Alice" });
		expect(result.success).toBe(false);
	});

	test("rejects amount exceeding 1,000,000", () => {
		const result = schema.safeParse({ amount: 1_000_001, recipient: "Alice" });
		expect(result.success).toBe(false);
	});

	test("rejects recipient exceeding 200 chars", () => {
		const result = schema.safeParse({
			amount: 100,
			recipient: "a".repeat(201),
		});
		expect(result.success).toBe(false);
	});

	test("rejects unknown keys", () => {
		const result = schema.safeParse({
			amount: 100,
			recipient: "Alice",
			extra: "bad",
		});
		expect(result.success).toBe(false);
	});
});
