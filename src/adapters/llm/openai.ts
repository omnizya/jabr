/**
 * openai.ts — OpenAI-compatible LLM adapter (9Router, Vercel AI Gateway, OpenAI).
 *
 * Handles:
 * - Standard OpenAI chat completions API
 * - 9Router's streaming deltas appended to non-stream responses
 * - Budget tracking via BudgetPort
 */

import type { BudgetPort } from "@ports/budget-port";
import type { LlmPort, LlmRequest, LlmResponse } from "@ports/llm-port";

const DEFAULT_MODEL_TEMPERATURE = 0.7;

function validateTemperature(t: number | undefined): number | undefined {
	if (t === undefined) return undefined;
	if (Number.isFinite(t) && t >= 0 && t <= 2) return t;
	console.warn(
		`[LlmAdapter] temperature ${t} out of range [0,2], using default`,
	);
	return undefined;
}

export class OpenAiLlmAdapter implements LlmPort {
	protected readonly baseUrl: string;
	protected readonly apiKey: string;
	protected readonly model: string;

	constructor(
		public readonly budget?: BudgetPort,
		opts?: { baseUrl?: string; apiKey?: string; model?: string },
	) {
		this.baseUrl = (
			opts?.baseUrl ??
			process.env.JABR_OPENAI_BASE_URL ??
			"https://api.openai.com/v1"
		).replace(/\/$/, "");
		this.apiKey = opts?.apiKey ?? process.env.JABR_OPENAI_API_KEY ?? "";
		this.model = opts?.model ?? process.env.JABR_OPENAI_MODEL ?? "gpt-4o";
	}

	get providerName(): string {
		return "openai";
	}

	async complete(
		messages: { role: string; content: string }[],
		opts?: { maxTokens?: number; system?: string },
	): Promise<{
		text: string;
		usage: { inputTokens: number; outputTokens: number };
	}> {
		const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
		const result = await this.generate({
			prompt,
			systemPrompt: opts?.system,
			maxTokens: opts?.maxTokens,
		});
		return {
			text: result.text,
			usage: {
				inputTokens: result.usage.promptTokens,
				outputTokens: result.usage.completionTokens,
			},
		};
	}

	async generate(request: LlmRequest): Promise<LlmResponse> {
		const temperature =
			validateTemperature(request.temperature) ?? DEFAULT_MODEL_TEMPERATURE;
		const response = await fetch(`${this.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: this.model,
				messages: [
					{ role: "system", content: request.systemPrompt || "" },
					{ role: "user", content: request.prompt },
				],
				temperature,
				max_tokens: request.maxTokens,
				stop: request.stopSequences,
				stream: false,
			}),
		});

		if (!response.ok) {
			throw new Error(
				`LLM API Error: ${response.status} ${await response.text()}`,
			);
		}

		// 9router may return streaming deltas even for stream:false.
		// Each line is "data: {json}". We need to concatenate delta.content.
		const raw = await response.text();

		// Try to parse as a single JSON object first
		try {
			const data = JSON.parse(raw);
			const choice = data.choices?.[0];
			if (choice?.message?.content !== undefined) {
				if (this.budget && data.usage) {
					await this.budget.consume("openai", data.usage.total_tokens);
				}
				return {
					text: choice.message.content,
					usage: {
						promptTokens: data.usage?.prompt_tokens ?? 0,
						completionTokens: data.usage?.completion_tokens ?? 0,
						totalTokens: data.usage?.total_tokens ?? 0,
					},
				};
			}
		} catch {
			// Not a single JSON object — fall through to streaming delta parse
		}

		// Parse streaming deltas: each "data: {...}" line is a delta frame
		let fullText = "";
		let usage:
			| {
					prompt_tokens?: number;
					completion_tokens?: number;
					total_tokens?: number;
			  }
			| undefined;
		const lines = raw.split("\n");

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("data:")) continue;
			const jsonStr = trimmed.slice(5).trim();
			if (jsonStr === "[DONE]") continue;

			try {
				const frame = JSON.parse(jsonStr);
				if (frame.usage) {
					usage = frame.usage;
				}
				const delta = frame.choices?.[0]?.delta;
				if (delta?.content) {
					fullText += delta.content;
				}
			} catch {
				// skip malformed frame
			}
		}

		if (this.budget && usage) {
			await this.budget.consume("openai", usage.total_tokens ?? 0);
		}

		if (fullText) {
			return {
				text: fullText,
				usage: {
					promptTokens: usage?.prompt_tokens ?? 0,
					completionTokens: usage?.completion_tokens ?? 0,
					totalTokens: usage?.total_tokens ?? 0,
				},
			};
		}

		// Fallback: try to extract between first { and last } (original behavior)
		const start = raw.indexOf("{");
		const end = raw.lastIndexOf("}");
		if (start === -1 || end <= start) {
			throw new Error(
				`LLM API Error: could not parse response: ${raw.slice(0, 200)}`,
			);
		}

		const data = JSON.parse(raw.slice(start, end + 1)) as any;
		const choice = data.choices?.[0];

		// Guard: some providers return a different choice shape
		if (!choice || !choice.message) {
			throw new Error(
				`LLM API Error: unexpected choice shape: ${JSON.stringify(choice).slice(0, 200)}`,
			);
		}

		if (this.budget && data.usage) {
			await this.budget.consume("openai", data.usage.total_tokens);
		}

		return {
			text: choice.message.content,
			usage: {
				promptTokens: data.usage?.prompt_tokens ?? 0,
				completionTokens: data.usage?.completion_tokens ?? 0,
				totalTokens: data.usage?.total_tokens ?? 0,
			},
		};
	}

	async streamGenerate(
		request: LlmRequest,
		onChunk: (chunk: string) => void,
	): Promise<LlmResponse> {
		const temperature =
			validateTemperature(request.temperature) ?? DEFAULT_MODEL_TEMPERATURE;
		const response = await fetch(`${this.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: this.model,
				messages: [
					{ role: "system", content: request.systemPrompt || "" },
					{ role: "user", content: request.prompt },
				],
				temperature,
				max_tokens: request.maxTokens,
				stop: request.stopSequences,
				stream: true,
			}),
		});

		if (!response.ok) {
			throw new Error(
				`LLM API Error: ${response.status} ${await response.text()}`,
			);
		}

		const reader = response.body?.getReader();
		if (!reader) throw new Error("No response body stream");

		const decoder = new TextDecoder();
		let fullText = "";
		let usage:
			| {
					prompt_tokens?: number;
					completion_tokens?: number;
					total_tokens?: number;
			  }
			| undefined;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			const chunk = decoder.decode(value, { stream: true });
			const lines = chunk.split("\n");

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith("data:")) continue;
				const jsonStr = trimmed.slice(5).trim();
				if (jsonStr === "[DONE]") continue;

				try {
					const frame = JSON.parse(jsonStr);
					if (frame.usage) {
						usage = frame.usage;
					}
					const delta = frame.choices?.[0]?.delta;
					if (delta?.content) {
						fullText += delta.content;
						onChunk(delta.content);
					}
				} catch {
					// skip malformed frame
				}
			}
		}

		if (this.budget && usage) {
			await this.budget.consume("openai", usage.total_tokens ?? 0);
		}

		return {
			text: fullText,
			usage: {
				promptTokens: usage?.prompt_tokens ?? 0,
				completionTokens: usage?.completion_tokens ?? 0,
				totalTokens: usage?.total_tokens ?? 0,
			},
		};
	}
}
