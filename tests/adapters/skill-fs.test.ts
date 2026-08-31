import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillFS } from "@adapters/skill-fs";
import type { SkillDocument } from "@agents/types";

function tempDir() {
	return mkdtempSync(join(tmpdir(), "skillfs-test-"));
}

function makeDoc(overrides: Partial<SkillDocument> = {}): SkillDocument {
	return {
		name: "test-skill",
		description: "a test skill",
		tags: ["test"],
		steps: ["step 1", "step 2"],
		createdAt: new Date().toISOString(),
		usageCount: 0,
		successRate: 1,
		...overrides,
	};
}

describe("SkillFS.save", () => {
	let dir: string;

	beforeEach(() => {
		dir = tempDir();
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("returns true and writes a JSON file for a new slug", () => {
		const fs = new SkillFS(dir);
		const doc = makeDoc({ name: "my-skill", tags: ["alpha"], usageCount: 5 });

		const result = fs.save("my-skill", doc);

		expect(result).toBe(true);
		expect(existsSync(join(dir, "my-skill.json"))).toBe(true);

		const written = JSON.parse(
			readFileSync(join(dir, "my-skill.json"), "utf-8"),
		);
		expect(written.name).toBe("my-skill");
		expect(written.tags).toEqual(["alpha"]);
		expect(written.usageCount).toBe(5);
	});

	test("overwrites the file and returns true when saving a duplicate slug", () => {
		const fs = new SkillFS(dir);
		const first = makeDoc({
			name: "beta",
			description: "first version",
			usageCount: 1,
		});
		const second = makeDoc({
			name: "beta",
			description: "second version",
			usageCount: 42,
		});

		fs.save("beta", first);
		const result = fs.save("beta", second);

		expect(result).toBe(true);

		const written = JSON.parse(readFileSync(join(dir, "beta.json"), "utf-8"));
		expect(written.description).toBe("second version");
		expect(written.usageCount).toBe(42);
		expect(written.name).toBe("beta");
	});

	test("list() includes the slug after save", () => {
		const fs = new SkillFS(dir);

		fs.save("alpha", makeDoc());
		fs.save("beta", makeDoc());

		expect(fs.list()).toContain("alpha");
		expect(fs.list()).toContain("beta");
		expect(fs.list()).toHaveLength(2);
	});

	test("exists() returns true after save", () => {
		const fs = new SkillFS(dir);

		fs.save("gamma", makeDoc());

		expect(fs.exists("gamma")).toBe(true);
		expect(fs.exists("missing")).toBe(false);
	});

	test("overwrites leave only one file on disk for the slug", () => {
		const fs = new SkillFS(dir);

		fs.save("single", makeDoc({ usageCount: 0 }));
		fs.save("single", makeDoc({ usageCount: 99 }));

		expect(fs.list()).toEqual(["single"]);
		const written = JSON.parse(readFileSync(join(dir, "single.json"), "utf-8"));
		expect(written.usageCount).toBe(99);
	});
});
