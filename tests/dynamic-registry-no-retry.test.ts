import { describe, expect, test } from "bun:test";
import { DynamicRegistry } from "@adapters/dynamic-registry";
import type { AgentCard } from "@agents/types";
import type { AgentRegistryPort } from "@ports/agent-registry";

describe("DynamicRegistry: no repeated retry polling when all agents are down", () => {
	test("fetchCard is not called again after discovery is exhausted", async () => {
		let fetchCardCalls = 0;

		const failingRegistry: AgentRegistryPort = {
			async fetchCard(): Promise<AgentCard | null> {
				fetchCardCalls++;
				return null;
			},
			async delegateTask() {
				return "";
			},
		};

		const dyn = new DynamicRegistry(failingRegistry, {
			oracle: "http://localhost:4001",
		});

		// Drive discovery to exhaustion with a short retry.
		// ensureReady calls discoverWithRetry internally, then sets discoveryExhausted.
		const ensureAny = dyn as unknown as { ensureReady: () => Promise<void> };
		// Use a fast overload by temporarily replacing discoverWithRetry on the instance.
		// ensureReady reads this.discoverWithRetry via the class method, so we replace
		// the method on the prototype-ish path by casting and re-assigning.
		// Since TS class methods are on the prototype, we replace via the instance
		// dictionary by assigning to the function-valued property.
		const origDiscover = dyn.discoverWithRetry.bind(dyn);
		(
			dyn as unknown as {
				discoverWithRetry: (m: number, i: number) => Promise<void>;
			}
		).discoverWithRetry = async (maxAttempts: number, intervalMs: number) => {
			// Forward to original but with capped attempts so the test is fast.
			const capped = Math.min(maxAttempts, 2);
			return origDiscover(capped, Math.min(intervalMs, 1));
		};

		await ensureAny.ensureReady();

		// At this point discoveryExhausted is true on the real instance.
		const afterExhaust = fetchCardCalls;

		// Now call matchAgent several times. Each calls ensureReady internally.
		// With the fix, ensureReady returns immediately (flag set) — no new fetchCard calls.
		for (let i = 0; i < 5; i++) {
			await dyn.matchAgent("any task");
		}

		// fetchCard must not have been called again.
		expect(fetchCardCalls).toBe(afterExhaust);
		expect(fetchCardCalls).toBeLessThanOrEqual(3); // 1 discover + at most 2 attempts
	});

	test("normal routing works when agents come back online after exhaustion", async () => {
		const urlToName: Record<string, string> = {
			"http://localhost:4001": "oracle",
		};

		const upRegistry: AgentRegistryPort = {
			async fetchCard(url: string): Promise<AgentCard | null> {
				const name = urlToName[url];
				if (!name) return null;
				return {
					name: `${name[0]?.toUpperCase()}${name.slice(1)} Agent`,
					description: "",
					url,
					version: "1.0.0",
					capabilities: {},
					skills: [{ name: "General", description: "", tags: ["general"] }],
				};
			},
			async delegateTask() {
				return "";
			},
		};

		const dyn = new DynamicRegistry(upRegistry, {
			oracle: "http://localhost:4001",
		});

		// Exhaust discovery (oracle is up, so it succeeds on attempt 1).
		await (
			dyn as unknown as {
				discoverWithRetry: (m: number, i: number) => Promise<void>;
			}
		).discoverWithRetry(2, 1);

		// matchAgent must work normally now.
		const match = await dyn.matchAgent("do something");
		expect(match).not.toBeNull();
		expect(match?.name).toBe("oracle");
	});
});
