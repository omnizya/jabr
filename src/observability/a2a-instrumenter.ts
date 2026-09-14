/**
 * observability/a2a-instrumenter.ts — A2A request/response span instrumentation.
 *
 * Wraps A2A SendMessage / SendStreamingMessage calls with SERVER or CLIENT spans.
 * Tracks: method, agent name, status code, latency, payload size, errors.
 */

import { getTracer, type Span, type SpanOptions } from "./tracer";

export class A2AInstrumenter {
	private tracer;

	constructor(instrumentationName: string) {
		this.tracer = getTracer(instrumentationName, "0.4.1");
	}

	/**
	 * Start a span for an inbound A2A request (server side).
	 */
	startServerSpan(
		method: string,
		attrs: {
			agentName?: string;
			taskId?: string;
			textLength?: number;
			caller?: string;
		} = {},
	): Span {
		const span = this.tracer.startSpan(`a2a.server.${method}`, {
			kind: "SERVER" as const,
			attributes: {
				"a2a.method": method,
				...(attrs.agentName ? { "jabr.agent": attrs.agentName } : {}),
				...(attrs.taskId ? { "jabr.task_id": attrs.taskId } : {}),
				...(attrs.textLength !== undefined
					? { "a2a.payload_length": attrs.textLength }
					: {}),
				...(attrs.caller ? { "jabr.caller": attrs.caller } : {}),
			},
		});
		return span;
	}

	/**
	 * Start a span for an outbound A2A request (client side).
	 */
	startClientSpan(
		method: string,
		targetAgent: string,
		attrs: {
			taskId?: string;
			textLength?: number;
			targetUrl?: string;
		} = {},
	): Span {
		const span = this.tracer.startSpan(`a2a.client.${method}`, {
			kind: "CLIENT" as const,
			attributes: {
				"a2a.method": method,
				"jabr.target_agent": targetAgent,
				...(attrs.taskId ? { "jabr.task_id": attrs.taskId } : {}),
				...(attrs.textLength !== undefined
					? { "a2a.payload_length": attrs.textLength }
					: {}),
				...(attrs.targetUrl
					? { "net.peer.name": new URL(attrs.targetUrl).hostname }
					: {}),
			},
		});
		return span;
	}

	/**
	 * Record the result of an A2A call onto a span.
	 */
	recordSuccess(span: Span, resultTextLength: number): void {
		span.setAttribute("a2a.response_length", resultTextLength);
		span.setStatus({ code: "OK" });
	}

	/**
	 * Record an error onto a span.
	 */
	recordError(span: Span, err: unknown): void {
		const message = err instanceof Error ? err.message : String(err);
		span.setAttribute(
			"error.type",
			err instanceof Error ? err.constructor.name : "UnknownError",
		);
		span.setAttribute("error.message", message);
		span.addEvent("error", { message });
		span.setStatus({ code: "ERROR", message });
	}
}
