import { NineRouterLlmAdapter } from "@adapters/llm/9router";
import { OpenAiLlmAdapter } from "@adapters/llm/openai";
import { VercelLlmAdapter } from "@adapters/llm/vercel";
import type { BudgetPort } from "@ports/budget-port";
import type { LlmPort } from "@ports/llm-port";
import { verbose } from "@utils/logger";

/**
 * Factory for the ecosystem's default LLM adapter.
 *
 * Provider selection (all opt-in; the default requires no billing):
 *   - `JABR_LLM_PROVIDER=openai`  → generic OpenAI-compatible adapter
 *     (any provider exposing `/chat/completions`; see JABR_OPENAI_* env vars)
 *   - `JABR_LLM_PROVIDER=vercel` OR a `VERCEL_AI_GATEWAY_KEY` is present
 *     → Vercel AI Gateway adapter
 *   - otherwise → 9Router (OpenRouter) adapter
 *   TODO: Add support for Anthropic and others
 */
export function createLlmAdapter(budget?: BudgetPort): LlmPort {
	const provider = process.env.JABR_LLM_PROVIDER;
	const hasVercelKey = !!(
		process.env.VERCEL_AI_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY
	);

	let selected = "9router";
	if (provider === "openai") {
		selected = "openai";
	} else if (provider === "vercel" || hasVercelKey) {
		selected = "vercel";
	}
	verbose(
		`[LlmFactory] selected provider=${selected} model=${
			selected === "openai"
				? (process.env.JABR_OPENAI_MODEL ?? "gpt-4o")
				: selected === "vercel"
					? (process.env.VERCEL_AI_GATEWAY_MODEL ?? "minimax/minimax-m3")
					: (
							process.env.NINEROUTER_MODEL ??
								"openrouter/minimax/minimax-m3:free"
						)
		}`,
	);

	if (provider === "openai") {
		return new OpenAiLlmAdapter(budget);
	}

	if (provider === "vercel" || hasVercelKey) {
		return new VercelLlmAdapter(budget);
	}

	return new NineRouterLlmAdapter(budget);
}
