import {
	V1_METHOD_SEND_MESSAGE,
	WELL_KNOWN_AGENT_CARD_JSON,
	WELL_KNOWN_AGENT_JSON,
} from "@constants/a2a-v1";
import { AGENT_CARD_PATH, KNOWN_AGENTS_NAME } from "@constants/known-agents";
import { a2aClientInstrumenter } from "@observability";
import {
	fromWireSendMessageResponse,
	toWireSendMessageRequest,
} from "@/adapters/a2a/serialize";
import type { AgentRegistryPort } from "@/ports/agent-registry";
import { BudgetExhaustedError, type BudgetPort } from "@/ports/budget-port";
import { loadTlsConfig } from "@/security/tls-config";
import type {
	Message,
	Part,
	SendMessageRequest,
	SendMessageResponse,
	Task,
} from "@/types/a2a-v1";
import type { AgentCard } from "@/types/types";
import type { JSONRPCRequest, JSONRPCResponse } from "@/utils/rpc";

export class A2AClient implements AgentRegistryPort {
	private cache: Map<string, AgentCard> = new Map();

	constructor(public readonly budget?: BudgetPort) {}

	private deriveAgentName(agentUrl: string): string | undefined {
		const url = agentUrl.toLowerCase();
		const known = KNOWN_AGENTS_NAME;
		return known.find((name) => url.includes(name));
	}

	async fetchCard(baseUrl: string): Promise<AgentCard | null> {
		const cached = this.cache.get(baseUrl);
		if (cached) {
			return cached;
		}

		const tlsConfig = await loadTlsConfig();
		const fetchOpts = tlsConfig ? { tls: { ca: tlsConfig.ca } } : {};

		// Try v1.0 well-known path first
		try {
			const res = await fetch(`${baseUrl}/${WELL_KNOWN_AGENT_JSON}`, {
				...fetchOpts,
			} as any);
			if (res.ok) {
				const card = (await res.json()) as AgentCard;
				this.cache.set(baseUrl, card);
				return card;
			}
		} catch {
			// Fall through to legacy path
		}

		// Fallback to legacy path
		try {
			const res = await fetch(`${baseUrl}/${AGENT_CARD_PATH}`, {
				...fetchOpts,
			} as any);
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
		callbackUrl?: string,
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

		// Build v1.0 SendMessageRequest using serializer (emits camelCase wire format)
		const message: Message = {
			role: "user",
			messageId: crypto.randomUUID(),
			parts: [{ kind: "text", text }],
		};

		const request: SendMessageRequest = {
			message,
			...(callbackUrl ? { notificationUrl: callbackUrl } : {}),
		};

		const body: JSONRPCRequest = {
			jsonrpc: "2.0",
			id: 1,
			method: V1_METHOD_SEND_MESSAGE,
			params: toWireSendMessageRequest(request),
		};

		try {
			console.log(
				`[A2AClient] → SendMessage to ${agentUrl} (agent=${name ?? "unknown"}, textLen=${text.length}, id=${body.id})`,
			);
			const start = performance.now();
			const tlsConfig = await loadTlsConfig();

			// --- OpenTelemetry client span ---
			const span = a2aClientInstrumenter.startClientSpan(
				"SendMessage",
				name ?? "unknown",
				{
					textLength: text.length,
					targetUrl: agentUrl,
				},
			);

			const res = await fetch(agentUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				...(tlsConfig ? { tls: { ca: tlsConfig.ca } } : {}),
			} as any);
			const latency = Math.round(performance.now() - start);

			if (!res.ok) {
				const msg = `[A2AClient] delegateTask failed: ${res.status} ${res.statusText}`;
				a2aClientInstrumenter.recordError(span, new Error(msg));
				span.end();
				console.error(msg);
				return msg;
			}

			const data = (await res.json()) as JSONRPCResponse;

			if (data.error) {
				const msg = `[A2AClient] delegateTask error: ${data.error.code} ${data.error.message}`;
				a2aClientInstrumenter.recordError(span, new Error(msg));
				span.end();
				console.error(msg);
				return msg;
			}

			// Parse v1.0 SendMessageResponse using serializer
			const response = fromWireSendMessageResponse(data.result);

			// Extract text with precedence: task.status.message.parts[0] → message.parts[0] → task.artifacts[0].parts[0]
			let resultText: string | undefined;

			if (response.task?.status?.message?.parts?.[0]?.kind === "text") {
				resultText = response.task.status.message.parts[0].text;
			} else if (response.message?.parts?.[0]?.kind === "text") {
				resultText = response.message.parts[0].text;
			} else if (response.task?.artifacts?.[0]?.parts?.[0]?.kind === "text") {
				resultText = response.task.artifacts[0].parts[0].text;
			}

			if (resultText !== undefined) {
				console.log(
					`[A2AClient] ← ${agentUrl} status=${res.status} latency=${latency}ms textLen=${resultText.length}`,
				);
				a2aClientInstrumenter.recordSuccess(span, resultText.length);
				span.end();
				return resultText;
			}

			console.log(
				`[A2AClient] ← ${agentUrl} status=${res.status} latency=${latency}ms (no text content)`,
			);
			a2aClientInstrumenter.recordSuccess(span, 0);
			span.end();
			return "[A2AClient] delegateTask: no text content in response";
		} catch (err) {
			const msg = `[A2AClient] delegateTask error: ${String(err)}`;
			console.error(msg, err);
			return msg;
		}
	}
}
