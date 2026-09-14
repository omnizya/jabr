/**
 * observability/delegation-instrumenter.ts — Cross-agent delegation trace instrumentation.
 *
 * Wraps ToolRouter.delegateTask() calls with spans that track:
 *   - source agent (orchestrator / parent)
 *   - target agent
 *   - delegation depth
 *   - latency
 *   - result size
 *   - errors
 */

import { getTracer, type Span } from "./tracer";

export interface DelegationSpanOptions {
	taskId?: string;
	sourceAgent: string;
	targetAgent: string;
	textLength?: number;
	depth?: number;
	parentSpanId?: string;
}

export class DelegationInstrumenter {
	private tracer;

	constructor() {
		this.tracer = getTracer("jabr-delegation", "0.4.1");
	}

	/**
	 * Start a span for a cross-agent delegation (e.g. orchestrator → oracle).
	 */
	startDelegationSpan(opts: DelegationSpanOptions): Span {
		const attributes: Record<string, string | number | boolean> = {
			"jabr.delegation.source": opts.sourceAgent,
			"jabr.delegation.target": opts.targetAgent,
			"jabr.delegation.direction": "outbound",
		};
		if (opts.taskId) attributes["jabr.task_id"] = opts.taskId;
		if (opts.textLength !== undefined)
			attributes["a2a.payload_length"] = opts.textLength;
		if (opts.depth !== undefined)
			attributes["jabr.delegation.depth"] = opts.depth;

		const span = this.tracer.startSpan(`jabr.delegate.${opts.targetAgent}`, {
			kind: "INTERNAL",
			attributes,
		});

		// If we have a parent span context, add as link (OpenTelemetry-style)
		if (opts.parentSpanId) {
			span.setAttribute("jabr.parent_span_id", opts.parentSpanId);
		}

		return span;
	}

	/**
	 * Record a successful delegation result.
	 */
	recordSuccess(span: Span, resultLength: number): void {
		span.setAttribute("jabr.delegation.result_length", resultLength);
		span.setAttribute("jabr.delegation.status", "ok");
		span.setStatus({ code: "OK" });
	}

	/**
	 * Record a delegation error.
	 */
	recordError(span: Span, err: unknown): void {
		const message = err instanceof Error ? err.message : String(err);
		span.setAttribute(
			"error.type",
			err instanceof Error ? err.constructor.name : "UnknownError",
		);
		span.setAttribute("error.message", message);
		span.setAttribute("jabr.delegation.status", "error");
		span.addEvent("delegation.error", { message });
		span.setStatus({ code: "ERROR", message });
	}
}
