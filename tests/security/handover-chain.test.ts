/**
 * handover-chain.test.ts — Tests for circular handoff detection.
 */

import { describe, expect, test } from "bun:test";
import {
	createCircularHandoffError,
	extendChain,
	formatChain,
	wouldCreateCycle,
} from "../../src/security/handover-chain";

describe("handover-chain", () => {
	describe("wouldCreateCycle", () => {
		test("empty chain never cycles", () => {
			expect(wouldCreateCycle([], "oracle")).toBe(false);
		});

		test("single agent no cycle", () => {
			expect(wouldCreateCycle(["oracle"], "fixer")).toBe(false);
		});

		test("direct A→B→A cycle detected", () => {
			expect(wouldCreateCycle(["oracle", "fixer"], "oracle")).toBe(true);
		});

		test("indirect A→B→C→A cycle detected", () => {
			expect(wouldCreateCycle(["oracle", "fixer", "librarian"], "oracle")).toBe(
				true,
			);
		});

		test("A→B→C→D no cycle", () => {
			expect(
				wouldCreateCycle(["oracle", "fixer", "librarian"], "designer"),
			).toBe(false);
		});

		test("self-loop detected (A→A)", () => {
			expect(wouldCreateCycle(["oracle"], "oracle")).toBe(true);
		});
	});

	describe("extendChain", () => {
		test("extends chain immutably", () => {
			const original = ["oracle", "fixer"];
			const extended = extendChain(original, "librarian");
			expect(extended).toEqual(["oracle", "fixer", "librarian"]);
			expect(original).toEqual(["oracle", "fixer"]); // unchanged
		});

		test("empty chain extends to single", () => {
			expect(extendChain([], "oracle")).toEqual(["oracle"]);
		});
	});

	describe("formatChain", () => {
		test("formats chain with arrows", () => {
			expect(formatChain(["oracle", "fixer", "librarian"])).toBe(
				"oracle → fixer → librarian",
			);
		});

		test("single agent no arrow", () => {
			expect(formatChain(["oracle"])).toBe("oracle");
		});
	});

	describe("createCircularHandoffError", () => {
		test("error message includes full chain", () => {
			const err = createCircularHandoffError(["oracle", "fixer"], "oracle");
			expect(err.message).toContain("oracle → fixer → oracle");
			expect(err.message).toContain("Circular handoff detected");
		});

		test("error message mentions rejection", () => {
			const err = createCircularHandoffError(["oracle"], "oracle");
			expect(err.message).toContain("Rejecting handover");
			expect(err.message).toContain("infinite loop");
		});
	});
});
