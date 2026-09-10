import type { BudgetPort, BudgetUsage } from "@ports/budget-port";

export interface RateLimitConfig {
	windowMs?: number;
	maxRequests?: number;
	resolveCaller?: (req: Request) => string;
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	resetAt: Date;
	retryAfterMs: number;
}

export class RateLimiter {
	private windows = new Map<string, number[]>();
	readonly windowMs: number;
	readonly maxRequests: number;
	private readonly resolveCaller: (req: Request) => string;

	constructor(config: RateLimitConfig = {}) {
		this.windowMs =
			config.windowMs ??
			(Number(process.env.JABR_RATE_LIMIT_WINDOW_MS) || 60_000);
		this.maxRequests =
			config.maxRequests ??
			(Number(process.env.JABR_RATE_LIMIT_MAX_REQUESTS) || 60);
		this.resolveCaller =
			config.resolveCaller ?? this.resolveCallerDefault.bind(this);
	}

	check(req: Request): RateLimitResult {
		const caller = this.resolveCaller(req);
		const now = performance.now();
		const timestamps = this.windows.get(caller) ?? [];
		const cutoff = now - this.windowMs;
		const alive = timestamps.filter((t) => t > cutoff);
		if (alive.length !== timestamps.length) this.windows.set(caller, alive);

		const used = alive.length;
		const allowed = used < this.maxRequests;

		let resetAt = new Date(Date.now() + this.windowMs);
		let retryAfterMs = this.windowMs;
		if (alive.length > 0) {
			const oldest = alive[0]!;
			const msUntilOldestExpires = oldest + this.windowMs - now;
			if (msUntilOldestExpires > 0) {
				resetAt = new Date(Date.now() + msUntilOldestExpires);
				retryAfterMs = Math.ceil(msUntilOldestExpires);
			}
		}

		if (allowed) {
			alive.push(now);
			this.windows.set(caller, alive);
		}

		// Report remaining AFTER recording this request (post-consumption semantics).
		const remaining = Math.max(0, this.maxRequests - alive.length);

		return { allowed, remaining, resetAt, retryAfterMs };
	}

	private resolveCallerDefault(req: Request): string {
		const apiKey = req.headers.get("X-API-Key");
		if (apiKey && apiKey.trim().length > 0) return `key:${apiKey.trim()}`;
		const xff = req.headers.get("X-Forwarded-For");
		if (xff) {
			const first = xff
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)[0];
			if (first) return `ip:${first}`;
		}
		const remote = (req as any).remoteAddress;
		if (typeof remote === "string" && remote.length > 0) return `ip:${remote}`;
		return "anonymous";
	}

	getSnapshot(): Record<
		string,
		{ used: number; cap: number; resetAt: string }
	> {
		const now = performance.now();
		const cut = now - this.windowMs;
		const out: Record<string, { used: number; cap: number; resetAt: string }> =
			{};
		for (const [caller, timestamps] of this.windows) {
			const alive = timestamps.filter((t) => t > cut);
			if (alive.length > 0) {
				this.windows.set(caller, alive);
				out[caller] = {
					used: alive.length,
					cap: this.maxRequests,
					resetAt: new Date(alive[0]! + this.windowMs).toISOString(),
				};
			}
		}
		return out;
	}

	reset(): void {
		this.windows.clear();
	}
}

export function rateLimitResponse(retryAfterMs: number): {
	status: number;
	body: object;
	headers: Record<string, string>;
} {
	return {
		status: 429,
		body: {
			jsonrpc: "2.0",
			id: null,
			error: {
				code: -32002,
				message: "Rate limit exceeded. Retry after the indicated window.",
				data: { retryAfterMs, retryAfterSec: Math.ceil(retryAfterMs / 1000) },
			},
		},
		headers: {
			"Content-Type": "application/json",
			"Retry-After": String(Math.ceil(retryAfterMs / 1000)),
			"X-RateLimit-Remaining": "0",
		},
	};
}
