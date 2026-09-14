/**
 * observability/index.ts — Public API for Jabr OpenTelemetry instrumentation.
 *
 * Usage:
 *   import { instrumentA2ARequest, instrumentDelegation, metrics } from "@/observability";
 *
 *   const span = instrumentA2ARequest("SendMessage", agentName);
 *   try {
 *     const result = await delegate(...);
 *     span.setStatus({ code: "OK" });
 *     return result;
 *   } catch (err) {
 *     span.setStatus({ code: "ERROR", message: String(err) });
 *     throw err;
 *   } finally {
 *     span.end();
 *   }
 */

export { A2AInstrumenter } from "./a2a-instrumenter";
export { DelegationInstrumenter } from "./delegation-instrumenter";

export { getOtelConfig } from "./env";
export { TaskMetrics } from "./task-metrics";
export type {
	CounterMetric,
	GaugeMetric,
	HistogramMetric,
	Meter,
	Span,
	SpanKind,
	SpanOptions,
	SpanStatusCode,
} from "./tracer";
export {
	getMeter,
	getTracer,
	getTracerProvider,
	shutdownTracerProvider,
} from "./tracer";

// ---------------------------------------------------------------------------
// Convenience: pre-built instrumenters and metrics
// ---------------------------------------------------------------------------

import { A2AInstrumenter } from "./a2a-instrumenter";
import { DelegationInstrumenter } from "./delegation-instrumenter";
import { TaskMetrics } from "./task-metrics";

/**
 * Shared A2A instrumenter for server-side request handling.
 * Use in A2AServer to wrap SendMessage / SendStreamingMessage.
 */
export const a2aServerInstrumenter = new A2AInstrumenter("jabr-a2a-server");

/**
 * Shared A2A instrumenter for client-side delegation.
 * Use in A2AClient / X402Client to wrap outbound calls.
 */
export const a2aClientInstrumenter = new A2AInstrumenter("jabr-a2a-client");

/**
 * Shared delegation instrumenter for cross-agent task routing.
 */
export const delegationInstrumenter = new DelegationInstrumenter();

/**
 * Shared task metrics (duration, error rate, cost).
 */
export const taskMetrics = new TaskMetrics();
