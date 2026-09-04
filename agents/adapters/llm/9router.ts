import { OpenAiLlmAdapter } from "@adapters/llm/openai";
import {
	NINEROUTER_MODEL_DEFAULT,
	NINEROUTER_URL_DEFAULT,
} from "@constants/ecosystem";
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
			process.env.NINEROUTER_URL ??
			NINEROUTER_URL_DEFAULT
		).replace(/\/$/, "");
		super(budget, {
			baseUrl: `${baseUrl}/v1`,
			apiKey:
				process.env.NINEROUTER_KEY ?? "",
			model:
				process.env.NINEROUTER_MODEL ?? NINEROUTER_MODEL_DEFAULT,
		});
	}
}
