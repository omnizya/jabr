import { NineRouterLlmAdapter } from "@adapters/llm/9router";
import { VercelLlmAdapter } from "@adapters/llm/vercel";
import type { BudgetPort } from "@ports/budget-port";
import type { LlmPort } from "@ports/llm-port";

/**
 * Factory for the ecosystem's default LLM adapter.
 *
 * Selects the Vercel AI Gateway adapter when explicitly requested via
 * `JABR_LLM_PROVIDER=vercel` OR when a `VERCEL_AI_GATEWAY_KEY` is present.
 * Otherwise falls back to the 9Router (OpenRouter) adapter.
 */
export function createLlmAdapter(budget?: BudgetPort): LlmPort {
  const provider = process.env.JABR_LLM_PROVIDER;
  const hasVercelKey = !!(process.env.VERCEL_AI_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY);

  if (provider === "vercel" || hasVercelKey) {
    return new VercelLlmAdapter(budget);
  }

  return new NineRouterLlmAdapter(budget);
}
