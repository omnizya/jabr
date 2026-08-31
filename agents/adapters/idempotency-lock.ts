/**
 * Redis-style in-memory lock with TTL, following the same design philosophy as
 * {@link RateLimiter} (`agents/adapters/rate-limit.ts`): sliding-window state
 * held in a Map, keyed by caller identity, with automatic expiry.
 *
 * Used by the webhook server to prevent duplicate processing of webhook events.
 * The lock key is the webhook event ID (e.g. `X-GitHub-Delivery`, Telegram
 * `update_id`, WhatsApp message `id`). When a lock is held, a repeated delivery
 * with the same event ID gets a 409 Conflict instead of being processed a second
 * time (at-least-once delivery + dedup).
 *
 * Design notes (mirrors RateLimiter):
 *  - TTL is configurable per-instance (default 24h, matching the research doc).
 *  - Lock acquisition is atomic: if the key is absent OR its TTL has expired,
 *    the caller wins and the entry is refreshed to now + ttlMs.
 *  - `getSnapshot()` mirrors RateLimiter.getSnapshot() for observability.
 *  - `reset()` clears all locks (useful in tests).
 */

export interface IdempotencyLockConfig {
	/** How long a lock stays held after acquisition (default 24h). */
	ttlMs?: number;
}

export interface LockResult {
	/** `true` when this call acquired the lock (first occurrence of the event). */
	acquired: boolean;
	/** When the lock was acquired / refreshed (utc ISO). */
	acquiredAt: Date;
	/** When the lock will expire if not refreshed (utc ISO). */
	expiresAt: Date;
	/** Milliseconds until the lock expires. */
	ttlRemainingMs: number;
}

export class IdempotencyLock {
	private locks = new Map<string, number>(); // key -> acquiredAt (ms)

	readonly ttlMs: number;

	constructor(config: IdempotencyLockConfig = {}) {
		this.ttlMs =
			config.ttlMs ??
			(Number(process.env.JABR_WEBHOOK_IDEMPOTENCY_TTL_MS) || 86_400_000);
	}

	/**
	 * Try to acquire the lock for `eventId`.
	 *
	 * Returns `{ acquired: true }` when this is the first occurrence (or the prior
	 * lock expired). Returns `{ acquired: false }` when the event is already locked
	 * and still within TTL.
	 */
	acquire(eventId: string): LockResult {
		const now = performance.now();
		const storedAt = this.locks.get(eventId);

		if (storedAt === undefined) {
			// No lock exists — we win.
			this.locks.set(eventId, now);
			const acquiredAt = new Date(now);
			const expiresAt = new Date(now + this.ttlMs);
			return {
				acquired: true,
				acquiredAt,
				expiresAt,
				ttlRemainingMs: this.ttlMs,
			};
		}

		const elapsed = now - storedAt;
		if (elapsed >= this.ttlMs) {
			// Prior lock expired — refresh it. The caller wins.
			this.locks.set(eventId, now);
			const acquiredAt = new Date(now);
			const expiresAt = new Date(now + this.ttlMs);
			return {
				acquired: true,
				acquiredAt,
				expiresAt,
				ttlRemainingMs: this.ttlMs,
			};
		}

		// Still locked.
		const expiresAt = new Date(storedAt + this.ttlMs);
		return {
			acquired: false,
			acquiredAt: new Date(storedAt),
			expiresAt,
			ttlRemainingMs: Math.ceil(expiresAt.getTime() - now),
		};
	}

	/** Return true when `eventId` is currently locked and not yet expired. */
	isLocked(eventId: string): boolean {
		const storedAt = this.locks.get(eventId);
		if (storedAt === undefined) return false;
		return performance.now() - storedAt < this.ttlMs;
	}

	/** Purge expired entries (mirrors RateLimiter's sliding-window cleanup). */
	gc(): void {
		const now = performance.now();
		const dead: string[] = [];
		for (const [key, storedAt] of this.locks) {
			if (now - storedAt >= this.ttlMs) dead.push(key);
		}
		for (const key of dead) this.locks.delete(key);
	}

	/** Observability: current lock state (mirrors RateLimiter.getSnapshot()). */
	getSnapshot(): Record<
		string,
		{ acquiredAt: string; expiresAt: string; ttlRemainingMs: number }
	> {
		this.gc();
		const now = performance.now();
		const out: Record<
			string,
			{ acquiredAt: string; expiresAt: string; ttlRemainingMs: number }
		> = {};
		for (const [key, storedAt] of this.locks) {
			const acquiredAt = new Date(storedAt);
			const expiresAt = new Date(storedAt + this.ttlMs);
			out[key] = {
				acquiredAt: acquiredAt.toISOString(),
				expiresAt: expiresAt.toISOString(),
				ttlRemainingMs: Math.ceil(expiresAt.getTime() - now),
			};
		}
		return out;
	}

	/** Clear all locks (useful in tests). Mirrors RateLimiter.reset(). */
	reset(): void {
		this.locks.clear();
	}
}

/**
 * Build a 409 Conflict JSON-RPC-style response for a replayed webhook event.
 * Mirrors `rateLimitResponse()` in shape.
 */
export function idempotencyConflictResponse(eventId: string): {
	status: number;
	body: object;
	headers: Record<string, string>;
} {
	return {
		status: 409,
		body: {
			jsonrpc: "2.0",
			id: null,
			error: {
				code: -32003,
				message: "Duplicate webhook event — already processed.",
				data: { eventId, ttlRemainingMs: -1 },
			},
		},
		headers: {
			"Content-Type": "application/json",
			"X-Idempotency-Replay": "true",
		},
	};
}
