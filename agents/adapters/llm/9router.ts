import { OpenAiLlmAdapter } from "@adapters/llm/openai";
import type { BudgetPort } from "@ports/budget-port";

/**
 * LLM adapter routing through 9Router (OpenAI-compatible gateway).
 * Default LLM adapter for the ecosystem — OpenAI is only used if you
 * construct OpenAiLlmAdapter directly.
 *
 * @Endpoint: POST ${NINEROUTER_URL}/v1/chat/completions
 * @Auth:     Authorization: Bearer ${NINEROUTER_KEY}
 * @Model:    ${NINEROUTER_MODEL} (default openrouter/minimax/minimax-m3:free)
 */
export class NineRouterLlmAdapter extends OpenAiLlmAdapter {
	constructor(budget?: BudgetPort) {
		const baseUrl = (
			process.env.NINEROUTER_URL ?? "http://127.0.0.1:20128"
		).replace(/\/$/, "");
		super(budget, {
			baseUrl: `${baseUrl}/v1`,
			apiKey:
				process.env.NINEROUTER_KEY ?? "sk-ac4453b102b24d2f-9eda9y-838fcb60",
			model:
				process.env.NINEROUTER_MODEL ?? "openrouter/minimax/minimax-m3:free",
		});
	}
}
