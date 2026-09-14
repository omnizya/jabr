/**
 * observability/tracer.ts — Lightweight OpenTelemetry-compatible tracer.
 *
 * Implements a minimal span/metrics model that exports to:
 *   - stdout: human-readable JSON lines (default, zero dependencies)
 *   - otlp: OTLP/JSON over HTTP (standard OTLP protocol)
 *
 * No external dependencies — uses native fetch for OTLP export.
 * Compatible with OpenTelemetry trace/span semantics so it can
 * later be swapped for the real SDK without changing call sites.
 */

import { getOtelConfig } from "./env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpanStatusCode = "UNSET" | "OK" | "ERROR";
export type SpanKind =
	| "INTERNAL"
	| "SERVER"
	| "CLIENT"
	| "PRODUCER"
	| "CONSUMER";

export interface Event {
	name: string;
	timestamp: number;
	attributes?: Record<string, string | number | boolean>;
}

export interface SpanContext {
	traceId: string;
	spanId: string;
	traceFlags?: number;
}

export interface SpanOptions {
	kind?: SpanKind;
	attributes?: Record<string, string | number | boolean>;
	links?: Array<{
		context: SpanContext;
		attributes?: Record<string, string | number | boolean>;
	}>;
}

export interface Span {
	name: string;
	context: SpanContext;
	kind: SpanKind;
	startTime: number;
	endTime?: number;
	status: { code: SpanStatusCode; message?: string };
	attributes: Record<string, string | number | boolean>;
	events: Event[];
	parentSpanId?: string;

	setAttribute(key: string, value: string | number | boolean): Span;
	setAttributes(attrs: Record<string, string | number | boolean>): Span;
	addEvent(
		name: string,
		attributes?: Record<string, string | number | boolean>,
	): Span;
	setStatus(status: { code: SpanStatusCode; message?: string }): Span;
	end(endTime?: number): void;
}

export interface ExportableSpan {
	name: string;
	context: SpanContext;
	kind: SpanKind;
	startTime: number;
	endTime?: number;
	status: { code: SpanStatusCode; message?: string };
	attributes: Record<string, string | number | boolean>;
	events: Event[];
	parentSpanId?: string;
	durationMs?: number;
}

// --- Metrics ---

export type MetricType = "counter" | "histogram" | "gauge";

export interface MetricRecord {
	name: string;
	type: MetricType;
	value: number;
	unit?: string;
	timestamp: number;
	attributes?: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// ID generation (OpenTelemetry-compatible: 32-hex traceId, 16-hex spanId)
// ---------------------------------------------------------------------------

function randomHex(bytes: number): string {
	const buf = new Uint8Array(bytes);
	crypto.getRandomValues(buf);
	return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateTraceId(): string {
	return randomHex(16);
}

function generateSpanId(): string {
	return randomHex(8);
}

// ---------------------------------------------------------------------------
// Exporter interface
// ---------------------------------------------------------------------------

interface SpanExporter {
	export(spans: ExportableSpan[]): Promise<void> | void;
	shutdown(): Promise<void> | void;
}

interface MetricExporter {
	export(metrics: MetricRecord[]): Promise<void> | void;
	shutdown(): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Stdout exporter
// ---------------------------------------------------------------------------

class StdoutSpanExporter implements SpanExporter {
	export(spans: ExportableSpan[]): void {
		for (const span of spans) {
			const record: Record<string, unknown> = {
				kind: "span",
				name: span.name,
				traceId: span.context.traceId,
				spanId: span.context.spanId,
				parentSpanId: span.parentSpanId,
				spanKind: span.kind,
				startTime: span.startTime,
				endTime: span.endTime,
				durationMs: span.durationMs,
				status: span.status,
				attributes: span.attributes,
				events: span.events,
			};
			console.log(JSON.stringify(record));
		}
	}
	async shutdown(): Promise<void> {}
}

class StdoutMetricExporter implements MetricExporter {
	export(metrics: MetricRecord[]): void {
		for (const m of metrics) {
			const record: Record<string, unknown> = {
				kind: "metric",
				name: m.name,
				type: m.type,
				value: m.value,
				unit: m.unit,
				timestamp: m.timestamp,
				attributes: m.attributes,
			};
			console.log(JSON.stringify(record));
		}
	}
	async shutdown(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// OTLP/JSON exporter (HTTP/protobuf wire format)
// ---------------------------------------------------------------------------

class OtlpSpanExporter implements SpanExporter {
	private endpoint: string;
	private serviceName: string;
	private headers: Record<string, string>;

	constructor(endpoint: string, serviceName: string) {
		this.endpoint = endpoint.replace(/\/$/, "");
		this.serviceName = serviceName;
		this.headers = { "Content-Type": "application/json" };
	}

	async export(spans: ExportableSpan[]): Promise<void> {
		if (spans.length === 0) return;

		// Group spans by instrumentation scope (service)
		const scopeSpans = new Map<string, ExportableSpan[]>();
		for (const span of spans) {
			const scope =
				(span.attributes["service.name"] as string) || this.serviceName;
			const arr = scopeSpans.get(scope) || [];
			arr.push(span);
			scopeSpans.set(scope, arr);
		}

		const resourceSpans = Array.from(scopeSpans.entries()).map(
			([scope, sps]) => ({
				resource: {
					attributes: [
						{ key: "service.name", value: { stringValue: scope } },
						{ key: "service.version", value: { stringValue: "0.4.1" } },
						{
							key: "deployment.environment",
							value: { stringValue: process.env.NODE_ENV || "development" },
						},
					],
				},
				scopeSpans: [
					{
						scope: { name: "jabr-otel", version: "0.4.1" },
						spans: sps.map((s) => this.toOtlpSpan(s)),
					},
				],
			}),
		);

		const body = JSON.stringify({ resourceSpans });

		try {
			await fetch(`${this.endpoint}/v1/traces`, {
				method: "POST",
				headers: this.headers,
				body,
				signal: AbortSignal.timeout(5000),
			});
		} catch (err) {
			console.error(`[OTLP] export failed: ${err}`);
		}
	}

	private toOtlpSpan(span: ExportableSpan): Record<string, unknown> {
		return {
			traceId: span.context.traceId,
			spanId: span.context.spanId,
			parentSpanId: span.parentSpanId,
			name: span.name,
			kind: this.mapSpanKind(span.kind),
			startUnixNano: String(span.startTime * 1_000_000),
			endUnixNano: String((span.endTime || span.startTime) * 1_000_000),
			attributes: Object.entries(span.attributes).map(([key, value]) => ({
				key,
				value: this.toOtlpAnyValue(value),
			})),
			events: span.events.map((e) => ({
				name: e.name,
				timeUnixNano: String(e.timestamp * 1_000_000),
				attributes: Object.entries(e.attributes || {}).map(([key, value]) => ({
					key,
					value: this.toOtlpAnyValue(value),
				})),
			})),
			status: {
				code:
					span.status.code === "OK" ? 1 : span.status.code === "ERROR" ? 2 : 0,
				message: span.status.message,
			},
		};
	}

	private mapSpanKind(kind: SpanKind): number {
		switch (kind) {
			case "INTERNAL":
				return 1;
			case "SERVER":
				return 2;
			case "CLIENT":
				return 3;
			case "PRODUCER":
				return 4;
			case "CONSUMER":
				return 5;
			default:
				return 1;
		}
	}

	private toOtlpAnyValue(
		value: string | number | boolean,
	): Record<string, unknown> {
		if (typeof value === "string") return { stringValue: value };
		if (typeof value === "number") {
			if (Number.isInteger(value)) return { intValue: String(value) };
			return { doubleValue: value };
		}
		return { boolValue: value };
	}

	async shutdown(): Promise<void> {}
}

class OtlpMetricExporter implements MetricExporter {
	private endpoint: string;
	private serviceName: string;
	private headers: Record<string, string>;

	constructor(endpoint: string, serviceName: string) {
		this.endpoint = endpoint.replace(/\/$/, "");
		this.serviceName = serviceName;
		this.headers = { "Content-Type": "application/json" };
	}

	async export(metrics: MetricRecord[]): Promise<void> {
		if (metrics.length === 0) return;

		const scopeMetrics = new Map<string, MetricRecord[]>();
		for (const m of metrics) {
			const scope =
				(m.attributes?.["service.name"] as string) || this.serviceName;
			const arr = scopeMetrics.get(scope) || [];
			arr.push(m);
			scopeMetrics.set(scope, arr);
		}

		const resourceMetrics = Array.from(scopeMetrics.entries()).map(
			([scope, mets]) => ({
				resource: {
					attributes: [{ key: "service.name", value: { stringValue: scope } }],
				},
				scopeMetrics: [
					{
						scope: { name: "jabr-otel", version: "0.4.1" },
						metrics: mets.map((m) => this.toOtlpMetric(m)),
					},
				],
			}),
		);

		const body = JSON.stringify({ resourceMetrics });

		try {
			await fetch(`${this.endpoint}/v1/metrics`, {
				method: "POST",
				headers: this.headers,
				body,
				signal: AbortSignal.timeout(5000),
			});
		} catch (err) {
			console.error(`[OTLP] metric export failed: ${err}`);
		}
	}

	private toOtlpMetric(m: MetricRecord): Record<string, unknown> {
		const base: Record<string, unknown> = {
			name: m.name,
			unit: m.unit || "",
			description: (m.attributes?.description as string) || "",
		};
		if (m.type === "counter" || m.type === "gauge") {
			(base as Record<string, unknown>).gauge = {
				dataPoints: [
					{
						timeUnixNano: String(m.timestamp * 1_000_000),
						asDouble: m.value,
						attributes: m.attributes
							? Object.entries(m.attributes)
									.filter(([k]) => k !== "description")
									.map(([key, value]) => ({
										key,
										value:
											typeof value === "string"
												? { stringValue: value }
												: Number.isInteger(value)
													? { intValue: String(value) }
													: { doubleValue: value as number },
									}))
							: [],
					},
				],
			};
		} else {
			(base as Record<string, unknown>).histogram = {
				dataPoints: [
					{
						timeUnixNano: String(m.timestamp * 1_000_000),
						count: 1,
						sum: m.value,
						bucketCounts: [1],
						explicitBounds: [0],
						attributes: m.attributes
							? Object.entries(m.attributes)
									.filter(([k]) => k !== "description")
									.map(([key, value]) => ({
										key,
										value:
											typeof value === "string"
												? { stringValue: value }
												: Number.isInteger(value)
													? { intValue: String(value) }
													: { doubleValue: value as number },
									}))
							: [],
					},
				],
				aggregationTemporality: 2, // DELTA
			};
		}
		return base;
	}

	async shutdown(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// BatchProcessor — buffers and flushes on interval or size threshold
// ---------------------------------------------------------------------------

class BatchProcessor<T> {
	private buffer: T[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private exporter: SpanExporter | MetricExporter,
		private maxBatchSize: number = 50,
		private maxLatencyMs: number = 5000,
		private label: string = "batch",
	) {}

	add(item: T): void {
		this.buffer.push(item);
		if (this.buffer.length >= this.maxBatchSize) {
			this.flush();
		} else if (!this.timer) {
			this.timer = setTimeout(() => this.flush(), this.maxLatencyMs);
		}
	}

	flush(): void {
		if (this.buffer.length === 0) return;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		const batch = this.buffer.splice(0, this.buffer.length);
		try {
			(this.exporter.export as (items: T[]) => Promise<void> | void)(batch);
		} catch (err) {
			console.error(`[Otel:${this.label}] export error: ${err}`);
		}
	}

	async shutdown(): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.flush();
		await this.exporter.shutdown();
	}

	get pendingCount(): number {
		return this.buffer.length;
	}
}

// ---------------------------------------------------------------------------
// Span implementation
// ---------------------------------------------------------------------------

class SpanImpl implements Span {
	name: string;
	kind: SpanKind;
	startTime: number;
	endTime?: number;
	status: { code: SpanStatusCode; message?: string } = { code: "UNSET" };
	attributes: Record<string, string | number | boolean> = {};
	events: Event[] = [];
	parentSpanId?: string;
	context!: SpanContext;

	private tracer: TracerImpl;
	private ended = false;

	constructor(tracer: TracerImpl, name: string, options: SpanOptions = {}) {
		this.tracer = tracer;
		this.name = name;
		this.kind = options.kind || "INTERNAL";
		this.parentSpanId = tracer.activeSpanId;
		this.startTime = Date.now();
		if (options.attributes) {
			this.attributes = { ...options.attributes };
		}
	}

	setAttribute(key: string, value: string | number | boolean): Span {
		if (!this.ended) this.attributes[key] = value;
		return this;
	}

	setAttributes(attrs: Record<string, string | number | boolean>): Span {
		if (!this.ended) {
			for (const [k, v] of Object.entries(attrs)) {
				this.attributes[k] = v;
			}
		}
		return this;
	}

	addEvent(
		name: string,
		attributes?: Record<string, string | number | boolean>,
	): Span {
		if (!this.ended) {
			this.events.push({ name, timestamp: Date.now(), attributes });
		}
		return this;
	}

	setStatus(status: { code: SpanStatusCode; message?: string }): Span {
		if (!this.ended) this.status = status;
		return this;
	}

	end(endTime?: number): void {
		if (this.ended) return;
		this.ended = true;
		this.endTime = endTime || Date.now();
		this.tracer.processor.add(this.toExportable());
	}

	durationMs(): number {
		return (this.endTime || Date.now()) - this.startTime;
	}

	toExportable(): ExportableSpan {
		return {
			name: this.name,
			context: this.context,
			kind: this.kind,
			startTime: this.startTime,
			endTime: this.endTime,
			durationMs: this.durationMs(),
			status: this.status,
			attributes: this.attributes,
			events: this.events,
			parentSpanId: this.parentSpanId,
		};
	}
}

// ---------------------------------------------------------------------------
// Tracer implementation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Meter implementation
// ---------------------------------------------------------------------------

class MeterImpl {
	private processor: BatchProcessor<MetricRecord>;

	constructor(processor: BatchProcessor<MetricRecord>) {
		this.processor = processor;
	}

	createCounter(
		name: string,
		options: { description?: string; unit?: string } = {},
	): CounterMetric {
		return new CounterMetricImpl(this.processor, name, options);
	}

	createHistogram(
		name: string,
		options: { description?: string; unit?: string } = {},
	): HistogramMetric {
		return new HistogramMetricImpl(this.processor, name, options);
	}

	createGauge(
		name: string,
		options: { description?: string; unit?: string } = {},
	): GaugeMetric {
		return new GaugeMetricImpl(this.processor, name, options);
	}
}

interface CounterMetric {
	add(
		value: number,
		attributes?: Record<string, string | number | boolean>,
	): void;
}

interface HistogramMetric {
	record(
		value: number,
		attributes?: Record<string, string | number | boolean>,
	): void;
}

interface GaugeMetric {
	set(
		value: number,
		attributes?: Record<string, string | number | boolean>,
	): void;
}

class CounterMetricImpl implements CounterMetric {
	constructor(
		private processor: BatchProcessor<MetricRecord>,
		private name: string,
		private options: { description?: string; unit?: string },
	) {}

	add(
		value: number,
		attributes?: Record<string, string | number | boolean>,
	): void {
		this.processor.add({
			name: this.name,
			type: "counter",
			value,
			unit: this.options.unit,
			timestamp: Date.now(),
			attributes: {
				...(this.options.description
					? { description: this.options.description }
					: {}),
				...attributes,
			},
		});
	}
}

class HistogramMetricImpl implements HistogramMetric {
	constructor(
		private processor: BatchProcessor<MetricRecord>,
		private name: string,
		private options: { description?: string; unit?: string },
	) {}

	record(
		value: number,
		attributes?: Record<string, string | number | boolean>,
	): void {
		this.processor.add({
			name: this.name,
			type: "histogram",
			value,
			unit: this.options.unit,
			timestamp: Date.now(),
			attributes: {
				...(this.options.description
					? { description: this.options.description }
					: {}),
				...attributes,
			},
		});
	}
}

class GaugeMetricImpl implements GaugeMetric {
	constructor(
		private processor: BatchProcessor<MetricRecord>,
		private name: string,
		private options: { description?: string; unit?: string },
	) {}

	set(
		value: number,
		attributes?: Record<string, string | number | boolean>,
	): void {
		this.processor.add({
			name: this.name,
			type: "gauge",
			value,
			unit: this.options.unit,
			timestamp: Date.now(),
			attributes: {
				...(this.options.description
					? { description: this.options.description }
					: {}),
				...attributes,
			},
		});
	}
}

// ---------------------------------------------------------------------------
// TracerProvider — singleton lifecycle
// ---------------------------------------------------------------------------

export interface TracerProvider {
	getTracer(name: string, version?: string): Tracer;
	getMeter(name: string, version?: string): Meter;
	forceFlush(): Promise<void>;
	shutdown(): Promise<void>;
}

export interface Tracer {
	startSpan(name: string, options?: SpanOptions): Span;
	setActiveSpan(span: Span): void;
	get activeSpan(): Span | undefined;
}

export interface Meter {
	createCounter(
		name: string,
		options?: { description?: string; unit?: string },
	): CounterMetric;
	createHistogram(
		name: string,
		options?: { description?: string; unit?: string },
	): HistogramMetric;
	createGauge(
		name: string,
		options?: { description?: string; unit?: string },
	): GaugeMetric;
}

// Concrete types used by call sites
export type { CounterMetric, GaugeMetric, HistogramMetric };

// ---------------------------------------------------------------------------
// TracerProvider implementation
// ---------------------------------------------------------------------------

class TracerProviderImpl implements TracerProvider {
	private spanProcessor: BatchProcessor<ExportableSpan>;
	private metricProcessor: BatchProcessor<MetricRecord>;
	private tracers = new Map<string, Tracer>();
	private meters = new Map<string, MeterImpl>();
	private traceId: string;
	private spanCounter = 0;

	constructor(private config: ReturnType<typeof getOtelConfig>) {
		this.traceId = generateTraceId();

		const spanExporter: SpanExporter =
			config.exporter === "otlp"
				? new OtlpSpanExporter(config.otlpEndpoint, config.serviceName)
				: new StdoutSpanExporter();

		const metricExporter: MetricExporter =
			config.exporter === "otlp"
				? new OtlpMetricExporter(config.otlpEndpoint, config.serviceName)
				: new StdoutMetricExporter();

		this.spanProcessor = new BatchProcessor(spanExporter, 50, 5000, "spans");
		this.metricProcessor = new BatchProcessor(
			metricExporter,
			50,
			5000,
			"metrics",
		);
	}

	getTracer(name: string, version?: string): Tracer {
		const key = `${name}@${version || ""}`;
		let t = this.tracers.get(key);
		if (!t) {
			t = new TracerImpl(this);
			this.tracers.set(key, t);
		}
		return t;
	}

	getMeter(name: string, version?: string): Meter {
		const key = `${name}@${version || ""}`;
		let m = this.meters.get(key);
		if (!m) {
			m = new MeterImpl(this.metricProcessor);
			this.meters.set(key, m);
		}
		return m;
	}

	nextSpanId(): string {
		return generateSpanId();
	}

	getTraceId(): string {
		return this.traceId;
	}

	async forceFlush(): Promise<void> {
		await this.spanProcessor.flush();
		await this.metricProcessor.flush();
	}

	async shutdown(): Promise<void> {
		await this.spanProcessor.shutdown();
		await this.metricProcessor.shutdown();
	}
}

// ---------------------------------------------------------------------------
// Tracer (per-instrumentation-scope)
// ---------------------------------------------------------------------------

class TracerImpl implements Tracer {
	private active: Span | undefined;

	constructor(private provider: TracerProviderImpl) {}

	startSpan(name: string, options: SpanOptions = {}): Span {
		const span = new SpanImpl(this, name, options);
		span.context = {
			traceId: this.provider.getTraceId(),
			spanId: this.provider.nextSpanId(),
			traceFlags: 1, // sampled
		};
		// Set service name attribute
		span.setAttribute(
			"service.name",
			span.attributes["service.name"] || "jabr",
		);
		return span;
	}

	setActiveSpan(span: Span): void {
		this.active = span;
	}

	get activeSpan(): Span | undefined {
		return this.active;
	}

	get activeSpanId(): string | undefined {
		return this.active?.context.spanId;
	}

	get processor(): BatchProcessor<ExportableSpan> {
		return this.provider["spanProcessor"];
	}
}

// ---------------------------------------------------------------------------
// Singleton lifecycle
// ---------------------------------------------------------------------------

let globalProvider: TracerProviderImpl | null = null;

export function getTracerProvider(): TracerProvider {
	if (!globalProvider) {
		const config = getOtelConfig();
		globalProvider = new TracerProviderImpl(config);
		// Auto-flush on process exit
		if (typeof process !== "undefined") {
			process.on("beforeExit", () => {
				globalProvider?.forceFlush().catch(() => {});
			});
		}
	}
	return globalProvider;
}

export function shutdownTracerProvider(): Promise<void> {
	if (globalProvider) {
		return globalProvider.shutdown().catch(() => {});
	}
	return Promise.resolve();
}

// Convenience shortcuts
export function getTracer(name: string, version?: string): Tracer {
	return getTracerProvider().getTracer(name, version);
}

export function getMeter(name: string, version?: string): Meter {
	return getTracerProvider().getMeter(name, version);
}
