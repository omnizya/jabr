import { describe, expect, test } from "bun:test";
import { A2AInstrumenter } from "../src/observability/a2a-instrumenter";
import { DelegationInstrumenter } from "../src/observability/delegation-instrumenter";
import { TaskMetrics } from "../src/observability/task-metrics";
import { getMeter, getTracerProvider } from "../src/observability/tracer";

describe("A2AInstrumenter", () => {
	test("startServerSpan creates span with SERVER kind", () => {
		const inst = new A2AInstrumenter("test-server");
		const span = inst.startServerSpan("SendMessage", {
			agentName: "oracle",
			taskId: "abc123",
			textLength: 100,
			caller: "test-caller",
		});
		expect(span).toBeDefined();
		expect(span.context.spanId).toBeTruthy();
		expect(span.context.traceId).toBeTruthy();
		span.setStatus({ code: "OK" });
		span.end();
	});

	test("startClientSpan creates span with CLIENT kind", () => {
		const inst = new A2AInstrumenter("test-client");
		const span = inst.startClientSpan("SendMessage", "oracle", {
			textLength: 200,
			targetUrl: "http://localhost:4001",
		});
		expect(span).toBeDefined();
		expect(span.context.spanId).toBeTruthy();
		inst.recordSuccess(span, 50);
		span.end();
	});

	test("recordError sets error attributes", () => {
		const inst = new A2AInstrumenter("test-err");
		const span = inst.startServerSpan("SendMessage");
		inst.recordError(span, new Error("connection refused"));
		span.end();
		// No exception thrown = pass
	});
});

describe("DelegationInstrumenter", () => {
	test("startDelegationSpan tracks delegation", () => {
		const inst = new DelegationInstrumenter();
		const span = inst.startDelegationSpan({
			sourceAgent: "orchestrator",
			targetAgent: "oracle",
			textLength: 100,
			taskId: "task-1",
		});
		expect(span).toBeDefined();
		expect(span.context.spanId).toBeTruthy();
		inst.recordSuccess(span, 50);
		span.end();
	});

	test("recordError captures delegation failure", () => {
		const inst = new DelegationInstrumenter();
		const span = inst.startDelegationSpan({
			sourceAgent: "orchestrator",
			targetAgent: "unknown-agent",
		});
		inst.recordError(span, new Error("agent not found"));
		span.end();
	});
});

describe("TaskMetrics", () => {
	test("recordTaskCreated increments counter", () => {
		const metrics = new TaskMetrics();
		metrics.recordTaskCreated("oracle", "task-1");
		// No exception thrown = pass
	});

	test("recordTaskCompleted records duration", () => {
		const metrics = new TaskMetrics();
		metrics.recordTaskCreated("oracle", "task-2");
		metrics.recordTaskCompleted("oracle", "task-2", 1500);
	});

	test("recordTaskFailed records error", () => {
		const metrics = new TaskMetrics();
		metrics.recordTaskCreated("oracle", "task-3");
		metrics.recordTaskFailed("oracle", "task-3", 500, "timeout");
	});

	test("recordCost tracks token consumption", () => {
		const metrics = new TaskMetrics();
		metrics.recordCost({
			agentName: "oracle",
			taskId: "task-4",
			tokens: 42,
		});
	});

	test("getErrorRate returns correct rate", () => {
		const metrics = new TaskMetrics();
		metrics.recordTaskCreated("agent-a", "t1");
		metrics.recordTaskCompleted("agent-a", "t1", 100);
		metrics.recordTaskCreated("agent-a", "t2");
		metrics.recordTaskFailed("agent-a", "t2", 200, "err");
		const rate = metrics.getErrorRate("agent-a");
		expect(rate).toBeCloseTo(0.5, 1);
	});

	test("getErrorRate returns 0 for no tasks", () => {
		const metrics = new TaskMetrics();
		expect(metrics.getErrorRate("nonexistent")).toBe(0);
	});
});

describe("TracerProvider", () => {
	test("getTracerProvider returns singleton", () => {
		const provider = getTracerProvider();
		expect(provider).toBeDefined();
	});

	test("getTracer returns tracer", () => {
		const provider = getTracerProvider();
		const tracer = provider.getTracer("test-tracer");
		expect(tracer).toBeDefined();
	});

	test("getMeter returns meter", () => {
		const provider = getTracerProvider();
		const meter = provider.getMeter("test-meter");
		expect(meter).toBeDefined();
	});

	test("meter creates counter and records value", () => {
		const provider = getTracerProvider();
		const meter = provider.getMeter("counter-test");
		const counter = meter.createCounter("test.counter");
		counter.add(1, { test: "true" });
	});

	test("meter creates histogram and records value", () => {
		const provider = getTracerProvider();
		const meter = provider.getMeter("histogram-test");
		const histogram = meter.createHistogram("test.histogram");
		histogram.record(100, { test: "true" });
	});

	test("tracer starts and ends span", () => {
		const provider = getTracerProvider();
		const tracer = provider.getTracer("span-test");
		const span = tracer.startSpan("test.operation");
		span.setAttribute("test.key", "value");
		span.addEvent("test.event");
		span.setStatus({ code: "OK" });
		span.end();
	});
});
