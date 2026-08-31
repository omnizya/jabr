import type { AgentCard } from "@agents/types";
import type { AgentRegistryPort } from "@ports/agent-registry";
import type { BudgetPort } from "@ports/budget-port";
import { BudgetExhaustedError } from "@ports/budget-port";
import type { JSONRPCRequest, JSONRPCResponse } from "@utils/rpc";

export class A2AClient implements AgentRegistryPort {
	private cache: Map<string, AgentCard> = new Map();

	constructor(public readonly budget?: BudgetPort) {}

	private deriveAgentName(agentUrl: string): string | undefined {
		const url = agentUrl.toLowerCase();
		const known = [
			"scientist",
			"fixer",
			"oracle",
			"designer",
			"librarian",
			"explorer",
			"jarvis",
		];
		return known.find((name) => url.includes(name));
	}

	async fetchCard(baseUrl: string): Promise<AgentCard | null> {
		const cached = this.cache.get(baseUrl);
		if (cached) {
			return cached;
		}

		try {
			const res = await fetch(`${baseUrl}/.well-known/agent-card.json`);
			if (!res.ok) {
				console.error(
					`[A2AClient] fetchCard failed: ${res.status} ${res.statusText}`,
				);
				return null;
			}
			const card = (await res.json()) as AgentCard;
			this.cache.set(baseUrl, card);
			return card;
		} catch (err) {
			console.error(`[A2AClient] fetchCard error for ${baseUrl}:`, err);
			return null;
		}
	}

	async delegateTask(
		agentUrl: string,
		text: string,
		agentName?: string,
	): Promise<string> {
		// Budget check before dispatch. Prefer the explicit agent name (seed key) when
		// provided; fall back to a best-effort URL substring match only as a last resort.
		const name = agentName ?? this.deriveAgentName(agentUrl);

		if (this.budget && name) {
			if (this.budget.isExhausted(name)) {
				console.error(
					`[A2AClient] budget exhausted for agent=${name} → ${agentUrl}`,
				);
				throw new BudgetExhaustedError(name, await this.budget.remaining(name));
			}
			console.log(`[A2AClient] budget ok for agent=${name} → ${agentUrl}`);
		}

		const body: JSONRPCRequest = {
			jsonrpc: "2.0",
			id: 1,
			method: "tasks/send",
			params: {
				message: {
					role: "user",
					parts: [{ kind: "text", text }],
				},
			},
		};

		try {
			console.log(
				`[A2AClient] → tasks/send to ${agentUrl} (agent=${name ?? "unknown"}, textLen=${text.length}, id=${body.id})`,
			);
			const start = performance.now();
			const res = await fetch(agentUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			const latency = Math.round(performance.now() - start);

			if (!res.ok) {
				const msg = `[A2AClient] delegateTask failed: ${res.status} ${res.statusText}`;
				console.error(msg);
				return msg;
			}

			const data = (await res.json()) as JSONRPCResponse;

			if (data.error) {
				const msg = `[A2AClient] delegateTask error: ${data.error.code} ${data.error.message}`;
				console.error(msg);
				return msg;
			}

			const result = data.result as
				| {
						text?: string;
						artifacts?: Array<{ parts?: Array<{ text?: string }> }>;
						message?: { parts?: Array<{ text?: string }> };
				  }
				| undefined;

			// The A2A server returns the flat `{ text }` shape (a2a-server.ts:88).
			if (result?.text) {
				console.log(
					`[A2AClient] ← ${agentUrl} status=${res.status} latency=${latency}ms textLen=${result.text.length}`,
				);
				return result.text;
			}
			if (result?.artifacts?.[0]?.parts?.[0]?.text) {
				const t = result.artifacts[0].parts[0].text;
				console.log(
					`[A2AClient] ← ${agentUrl} status=${res.status} latency=${latency}ms textLen=${t.length}`,
				);
				return t;
			}
			if (result?.message?.parts?.[0]?.text) {
				const t = result.message.parts[0].text;
				console.log(
					`[A2AClient] ← ${agentUrl} status=${res.status} latency=${latency}ms textLen=${t.length}`,
				);
				return t;
			}

			console.log(
				`[A2AClient] ← ${agentUrl} status=${res.status} latency=${latency}ms (no text content)`,
			);
			return "[A2AClient] delegateTask: no text content in response";
		} catch (err) {
			const msg = `[A2AClient] delegateTask error: ${String(err)}`;
			console.error(msg, err);
			return msg;
		}
	}
}
