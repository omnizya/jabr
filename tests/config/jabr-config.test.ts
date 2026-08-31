import { afterEach, beforeEach, describe, expect, it } from "bun:test";

// Import the raw env access and helper functions — they are NOT cached
// so we can test them directly.
import { JABR_URL_RAW } from "../../src/config/jabr-config";

describe("jabr-config (raw env access)", () => {
	const originalJabrUrl = process.env.JABR_URL;
	const originalOrchUrl = process.env.ORCHESTRATOR_URL;

	beforeEach(() => {
		delete process.env.JABR_URL;
		delete process.env.ORCHESTRATOR_URL;
		// Re-import will re-read process.env
	});

	afterEach(() => {
		if (originalJabrUrl !== undefined) {
			process.env.JABR_URL = originalJabrUrl;
		} else {
			delete process.env.JABR_URL;
		}
		if (originalOrchUrl !== undefined) {
			process.env.ORCHESTRATOR_URL = originalOrchUrl;
		} else {
			delete process.env.ORCHESTRATOR_URL;
		}
	});

	it("prefers JABR_URL over ORCHESTRATOR_URL", () => {
		process.env.JABR_URL = "http://jabr.local:4000";
		process.env.ORCHESTRATOR_URL = "http://legacy.local:4000";
		// Dynamic import to re-read env
		const mod = require("../../src/config/jabr-config");
		expect(mod.JABR_URL_RAW).toBe("http://jabr.local:4000");
	});

	it("falls back to ORCHESTRATOR_URL when JABR_URL is unset", () => {
		process.env.ORCHESTRATOR_URL = "http://legacy.local:4000";
		const mod = require("../../src/config/jabr-config");
		expect(mod.JABR_URL_RAW).toBe("http://legacy.local:4000");
	});

	it("returns undefined when neither is set", () => {
		const mod = require("../../src/config/jabr-config");
		expect(mod.JABR_URL_RAW).toBeUndefined();
	});
});
