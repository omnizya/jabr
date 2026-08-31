/**
 * Centralized application constants.
 *
 * Every magic number in the codebase that carries semantic meaning
 * (retry budgets, timeouts, model parameters, thresholds) belongs here
 * so that a single source of truth exists and values can be tuned without
 * hunting through call sites.
 *
 * Naming convention: ALL_CAPS_SNAKE for exported constants.
 * Each constant has a JSDoc block explaining its purpose and valid usage.
 */

// ---------------------------------------------------------------------------
// Discovery & retry
// ---------------------------------------------------------------------------

/** Maximum number of discovery poll attempts before the registry gives up
 * and marks discovery as exhausted.  Each attempt triggers a full
 * `discover()` pass plus a sleep, so this value also caps worst-case
 * discovery latency at `MAX_DISCOVER_ATTEMPTS * DISCOVER_POLL_INTERVAL_MS`.
 *
 * Used by {@link DynamicRegistry.discoverWithRetry}.
 *
 * @see DISCOVER_POLL_INTERVAL_MS
 */
export const MAX_DISCOVER_ATTEMPTS = 30;

/** Milliseconds to sleep between consecutive discovery attempts inside
 * {@link DynamicRegistry.discoverWithRetry}.  Tuned to balance fast agent
 * readiness detection against hammering agents that are still booting.
 *
 * @see MAX_DISCOVER_ATTEMPTS
 */
export const DISCOVER_POLL_INTERVAL_MS = 1_000;

/** Default retry budget for generic operation retries that are not
 * discovery-specific (e.g. transient network blips during LLM calls).
 * Raised from the legacy value of 7 because agents routinely boot in
 * parallel and need enough attempts to cover staggered startup.
 *
 * Consumers should prefer explicit budgets over this default when the
 * operation has a known latency SLO.
 */
export const DEFAULT_MAX_RETRIES = 7;

// ---------------------------------------------------------------------------
// Timeouts (milliseconds)
// ---------------------------------------------------------------------------

/** Default upper-bound timeout (ms) used as a safety ceiling for any operation
 * that does not carry its own explicit timeout.  Equal to the largest positive
 * 32-bit signed integer so that arithmetic on the value (e.g. addition for
 * retry backoff) cannot silently wrap into a negative timeout.  The name
 * mirrors the `timeoutMs` parameter convention used across the A2A port and
 * elicitation interfaces.
 *
 * Derived from the project's documented SLA for agent-facing operations, which
 * treat missing timeouts as unbounded and rely on this ceiling to keep runaway
 * calls from hanging indefinitely.  Consumers should prefer operation-specific
 * timeouts (e.g. {@link MCP_ELICITATION_TIMEOUT_MS}) over this catch-all
 * default whenever the operation has a documented latency SLO.
 */
export const DEFAULT_TIMEOUT_MS = Number.MAX_SAFE_INTEGER;

/** Upper bound for MCP elicitation requests.  Set to 5 minutes to mirror
 * the Hermes elicitation default and give users enough time to respond to
 * open-ended prompts without the call silently dropping.
 *
 * Used by {@link McpClient}.
 *
 * @see MCP_HEALTHCHECK_TIMEOUT_MS
 */
export const MCP_ELICITATION_TIMEOUT_MS = 300_000;

/** Timeout for a single MCP health-check HTTP request (the `.well-known`
 * agent-card fetch inside {@link DynamicRegistry.getAgentsHealth}).  Kept
 * short because it is a fire-and-forget probe — a slow agent does not block
 * the health report.
 */
export const MCP_HEALTHCHECK_TIMEOUT_MS = 2_000;

/** Default timeout for A2A `tasks/send` requests in E2E probes and manual
 * testing.  Short enough to surface a hung agent quickly, long enough to
 * survive a cold-start LLM call on a small model.
 *
 * Individual agents override this via per-agent timeout tables; this value
 * applies when no override is specified.
 *
 * @see AGENT_A2A_TIMEOUTS
 */
export const DEFAULT_A2A_TIMEOUT_MS = 5_000;

/** Fallback timeout used when no per-agent timeout is configured.
 * Equal to {@link DEFAULT_A2A_TIMEOUT_MS} so that code referencing either
 * constant stays in sync.
 */
export const A2A_FALLBACK_TIMEOUT_MS = DEFAULT_A2A_TIMEOUT_MS;

/** Per-agent A2A timeouts (milliseconds) used by E2E probes.
 * Tuned per agent role — research-heavy agents get more time than
 * quick-turnaround coding agents.
 *
 * Consumers should import this table rather than hardcoding role-specific
 * values inline.
 *
 * @see DEFAULT_A2A_TIMEOUT_MS
 */
export const AGENT_A2A_TIMEOUTS = {
	oracle: 40_000,
	librarian: 40_000,
	scientist: 60_000,
	jarvis: 90_000,
	explorer: 15_000,
	designer: 15_000,
	fixer: 15_000,
} as const;

// ---------------------------------------------------------------------------
// Model temperature
// ---------------------------------------------------------------------------

/** Temperature for research and factual retrieval agents (Librarian,
 * Oracle routing decisions).  Low value reduces hallucination and keeps
 * outputs deterministic so citations and route choices stay stable.
 *
 * Used by {@link LibrarianAgent} and {@link OracleAgent}.
 */
export const RESEARCH_TEMPERATURE = 0.2;

/** Temperature for synthesis / consensus agents (CognitiveLoop).  Slightly
 * higher than RESEARCH_TEMPERATURE to encourage the model to explore
 * alternative phrasings when merging multiple agent responses.
 *
 * Used by {@link CognitiveLoop.synthesize}.
 */
export const SYNTHESIS_TEMPERATURE = 0.3;

/** Default temperature for the OpenAI adapter when the caller does not
 * supply an explicit value.  Neutral-creative balance suitable for general
 * conversational and code-generation tasks.
 *
 * Used by {@link OpenaiLlmAdapter} as the fallback when
 * `request.temperature` is undefined.
 */
export const DEFAULT_MODEL_TEMPERATURE = 0.7;

// ---------------------------------------------------------------------------
// Convenience: all constants re-exported as a single namespace for wildcard
// imports that prefer `import * as C from "@constants/app"`.
// ---------------------------------------------------------------------------

/** Namespace bundling every constant in this module.  Use this when you
 * need to pass the whole constants object to a configuration helper or
 * reference multiple values without repeating the module path.
 *
 * Example:
 * ```ts
 * import { AppConstants } from "@constants/app";
 * console.log(AppConstants.MAX_DISCOVER_ATTEMPTS);
 * ```
 */
export const AppConstants = {
	MAX_DISCOVER_ATTEMPTS,
	DISCOVER_POLL_INTERVAL_MS,
	DEFAULT_MAX_RETRIES,
	MCP_ELICITATION_TIMEOUT_MS,
	MCP_HEALTHCHECK_TIMEOUT_MS,
	DEFAULT_A2A_TIMEOUT_MS,
	A2A_FALLBACK_TIMEOUT_MS,
	AGENT_A2A_TIMEOUTS,
	RESEARCH_TEMPERATURE,
	SYNTHESIS_TEMPERATURE,
	DEFAULT_MODEL_TEMPERATURE,
	DEFAULT_TIMEOUT_MS,
} as const;
