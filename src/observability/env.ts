/**
 * observability/env.ts — OpenTelemetry configuration from environment.
 *
 * JABR_OTEL_ENABLED  - "true" to enable tracing/metrics (default: false).
 * JABR_OTEL_EXPORTER - "stdout" or "otlp" (default: stdout).
 * JABR_OTEL_OTLP_ENDPOINT - OTLP gRPC/HTTP endpoint (default: http://localhost:4317).
 * JABR_OTEL_SERVICE_NAME - Service name for resource attribution (default: jabr).
 *
 * Memory context window (see adapters/context-compressor.ts):
 * JABR_MEMORY_MAX_TOKENS — soft token ceiling for memory read() compression (default 4000).
 * JABR_MEMORY_TTL_HOURS  — age after which entries are purged (default 24).
 * JABR_MEMORY_COMPRESS   — "false" to disable compression (default true).
 */

import { optionalBoolEnv, optionalEnv } from "@config/env-manager";

export interface OtelConfig {
	enabled: boolean;
	exporter: "stdout" | "otlp";
	otlpEndpoint: string;
	serviceName: string;
}

export function getOtelConfig(): OtelConfig {
	return {
		enabled: optionalBoolEnv("JABR_OTEL_ENABLED", false),
		exporter: (optionalEnv("JABR_OTEL_EXPORTER", "stdout") === "otlp"
			? "otlp"
			: "stdout") as "stdout" | "otlp",
		otlpEndpoint: optionalEnv(
			"JABR_OTEL_OTLP_ENDPOINT",
			"http://localhost:4317",
		),
		serviceName: optionalEnv("JABR_OTEL_SERVICE_NAME", "jabr"),
	};
}
