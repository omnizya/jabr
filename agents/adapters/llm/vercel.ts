import { DEFAULT_MODEL_TEMPERATURE } from "@constants/app-constants";
import type { BudgetPort } from "@ports/budget-port";
import type { LlmPort, LlmRequest, LlmResponse } from "@ports/llm-port";
import { validateTemperature } from "@ports/llm-port";
import type { LanguageModelUsage } from "ai";
import { createGateway, generateText, streamText } from "ai";

/**
 * LLM adapter routing through the Vercel AI Gateway (ai-gateway.vercel.sh).
 *
 * Uses the resilient model form: the standard `minimax/minimax-m3` ID with
 * `providerOptions.gateway.order = ['gmicloud']` so traffic prefers GMI Cloud
 * while the free tier is live (through Sept 6, 2026) and keeps working after
 * it ends by falling back to other providers (billed at provider rate).
 *
 * @Gateway:  https://ai-gateway.vercel.sh/v4/ai (override via VERCEL_AI_GATEWAY_BASE_URL)
 * @Auth:     VERCEL_AI_GATEWAY_KEY (or AI_GATEWAY_API_KEY)
 * @Model:    VERCEL_AI_GATEWAY_MODEL (default minimax/minimax-m3)
 */
export class VercelLlmAdapter implements LlmPort {
	private model: ReturnType<ReturnType<typeof createGateway>["chat"]>;

	constructor(
		private budget?: BudgetPort,
		opts?: { apiKey?: string; baseUrl?: string; model?: string },
	) {
		const apiKey =
			opts?.apiKey ??
			process.env.VERCEL_AI_GATEWAY_KEY ??
			process.env.AI_GATEWAY_API_KEY ??
			"";
		const baseUrl = opts?.baseUrl ?? process.env.VERCEL_AI_GATEWAY_BASE_URL;
		const model =
			opts?.model ??
			process.env.VERCEL_AI_GATEWAY_MODEL ??
			"minimax/minimax-m3";

		const gateway = createGateway({
			apiKey,
			...(baseUrl ? { baseURL: baseUrl } : {}),
		});
		this.model = gateway.chat(model);
	}

	private callOptions(request: LlmRequest) {
		return {
			model: this.model,
			system: request.systemPrompt,
			prompt: request.prompt,
			temperature:
				validateTemperature(request.temperature) ?? DEFAULT_MODEL_TEMPERATURE,
			...(request.maxTokens !== undefined
				? { maxTokens: request.maxTokens }
				: {}),
			...(request.stopSequences
				? { stopSequences: request.stopSequences }
				: {}),
			providerOptions: { gateway: { order: ["gmicloud"] } },
		};
	}

	private mapUsage(usage: LanguageModelUsage) {
		return {
			promptTokens: usage.inputTokens ?? 0,
			completionTokens: usage.outputTokens ?? 0,
			totalTokens: usage.totalTokens ?? 0,
		};
	}

	async generate(request: LlmRequest): Promise<LlmResponse> {
		try {
			const result = await generateText(this.callOptions(request));
			const usage = this.mapUsage(result.usage);

			if (this.budget) {
				await this.budget.consume("vercel", usage.totalTokens);
			}

			return { text: result.text, usage };
		} catch (e) {
			throw new Error(
				`[VercelLlmAdapter] generate failed: ${(e as Error).message}`,
			);
		}
	}

	async streamGenerate(
		request: LlmRequest,
		onChunk: (chunk: string) => void,
	): Promise<LlmResponse> {
		try {
			const result = streamText(this.callOptions(request));

			let fullText = "";
			for await (const chunk of result.textStream) {
				fullText += chunk;
				onChunk(chunk);
			}

			const usage = this.mapUsage(await result.usage);

			if (this.budget) {
				await this.budget.consume("vercel", usage.totalTokens);
			}

			return { text: fullText, usage };
		} catch (e) {
			throw new Error(
				`[VercelLlmAdapter] streamGenerate failed: ${(e as Error).message}`,
			);
		}
	}
}
