import { afterEach, beforeEach, describe, expect, it } from "bun:test";

// JABR_URL_RAW is captured at module load, so a fresh module instance is
// needed per test to re-read process.env. A query-string suffix defeats
// Bun's module cache for ESM dynamic imports.
let moduleSeq = 0;
function freshConfig(): Promise<typeof import("../../src/config/jabr-config")> {
	return import(`../../src/config/jabr-config?test=${moduleSeq++}`);
}

describe("jabr-config (raw env access)", () => {
	const originalJabrUrl = process.env.JABR_URL;
	const originalOrchUrl = process.env.ORCHESTRATOR_URL;

	beforeEach(() => {
		delete process.env.JABR_URL;
		delete process.env.ORCHESTRATOR_URL;
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

	it("prefers JABR_URL over ORCHESTRATOR_URL", async () => {
		process.env.JABR_URL = "http://jabr.local:4000";
		process.env.ORCHESTRATOR_URL = "http://legacy.local:4000";
		const mod = await freshConfig();
		expect(mod.JABR_URL_RAW).toBe("http://jabr.local:4000");
	});

	it("falls back to ORCHESTRATOR_URL when JABR_URL is unset", async () => {
		process.env.ORCHESTRATOR_URL = "http://legacy.local:4000";
		const mod = await freshConfig();
		expect(mod.JABR_URL_RAW).toBe("http://legacy.local:4000");
	});

	it("returns undefined when neither is set", async () => {
		const mod = await freshConfig();
		expect(mod.JABR_URL_RAW).toBeUndefined();
	});
});
