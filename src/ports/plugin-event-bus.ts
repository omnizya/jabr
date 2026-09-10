/**
 * PluginEventBus — pub/sub core with error isolation and middleware chains.
 *
 * Internal registry: Map<eventName, Set<SubscriberEntry>>.
 *
 * Error isolation: every handler invocation is wrapped so one throwing (or
 * rejecting) subscriber cannot break the dispatch loop. Errors are forwarded
 * to an optional `onError` callback; if omitted they are silently swallowed
 * (the bus never throws from emit/emitAsync).
 *
 * Middleware: a chain of `(payload, eventName) => transformedPayload | null`
 * functions applied per-subscription. Returning `null` short-circuits delivery
 * to that subscriber. Middleware runs in order, left-to-right, synchronously;
 * the output of one feeds into the next, then into the handler.
 *
 * Async safety: emit/emitAsync snapshot the subscriber set before iterating,
 * so concurrent subscribe/unsubscribe during dispatch cannot corrupt the loop.
 */

import type {
	EventHandler,
	EventMap,
	PluginEventBus,
	SubscriptionId,
} from "./plugin-event-bus.types.ts";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface SubscriberEntry<TPayload = unknown> {
	readonly id: SubscriptionId;
	readonly handler: EventHandler<TPayload>;
	readonly middleware: ReadonlyArray<Middleware<TPayload>>;
}

export type Middleware<TPayload = unknown> = (
	payload: TPayload,
	eventName: string,
) => TPayload | null | undefined;

export type ErrorHandler = (
	error: unknown,
	eventName: string,
	subscriptionId: SubscriptionId,
) => void;

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let _counter = 0;

function nextId(): SubscriptionId {
	_counter += 1;
	return `sub_${_counter}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// PluginEventBusImpl
// ---------------------------------------------------------------------------

export class PluginEventBusImpl<Events extends EventMap = EventMap>
	implements PluginEventBus<Events>
{
	private readonly _registry = new Map<
		keyof Events,
		Set<SubscriberEntry<unknown>>
	>();

	private readonly _globalMiddleware: ReadonlyArray<Middleware<unknown>>;
	private readonly _onError: ErrorHandler | undefined;

	constructor(options?: {
		middleware?: ReadonlyArray<Middleware<unknown>>;
		onError?: ErrorHandler;
	}) {
		this._globalMiddleware = options?.middleware ?? [];
		this._onError = options?.onError;
	}

	// -------------------------------------------------------------------------
	// Subscription lifecycle
	// -------------------------------------------------------------------------

	subscribe<K extends keyof Events>(
		eventName: K,
		handler: EventHandler<Events[K]>,
		options?: {
			middleware?: ReadonlyArray<Middleware<Events[K]>>;
		},
	): SubscriptionId {
		const id = nextId();
		const entry: SubscriberEntry<unknown> = {
			id,
			handler: handler as EventHandler<unknown>,
			middleware: (options?.middleware ?? []) as Middleware<unknown>[],
		};

		let set = this._registry.get(eventName);
		if (set === undefined) {
			set = new Set();
			this._registry.set(eventName, set);
		}
		set.add(entry);

		return id;
	}

	unsubscribe(subscriptionId: SubscriptionId): void {
		for (const [, set] of this._registry) {
			for (const entry of set) {
				if (entry.id === subscriptionId) {
					set.delete(entry);
					return;
				}
			}
		}
	}

	clear<K extends keyof Events>(eventName?: K): void {
		if (eventName === undefined) {
			this._registry.clear();
			return;
		}
		this._registry.delete(eventName);
	}

	listenerCount<K extends keyof Events>(eventName: K): number {
		return this._registry.get(eventName)?.size ?? 0;
	}

	// -------------------------------------------------------------------------
	// Emit
	// -------------------------------------------------------------------------

	emit<K extends keyof Events>(eventName: K, payload: Events[K]): void {
		const subscribers = this._registry.get(eventName);
		if (subscribers === undefined || subscribers.size === 0) return;

		const snapshot = [...subscribers];

		for (const entry of snapshot) {
			this._dispatchTo(entry, eventName, payload);
		}
	}

	async emitAsync<K extends keyof Events>(
		eventName: K,
		payload: Events[K],
	): Promise<void> {
		const subscribers = this._registry.get(eventName);
		if (subscribers === undefined || subscribers.size === 0) return;

		const snapshot = [...subscribers];

		const results = await Promise.allSettled(
			snapshot.map((entry) => this._dispatchToAsync(entry, eventName, payload)),
		);

		for (let i = 0; i < results.length; i++) {
			const result = results[i]!;
			if (result.status === "rejected") {
				const id = snapshot[i]!.id;
				this._reportError(result.reason, String(eventName), id);
			}
		}
	}

	// -------------------------------------------------------------------------
	// Private dispatch helpers
	// -------------------------------------------------------------------------

	private _dispatchTo(
		entry: SubscriberEntry<unknown>,
		eventName: keyof Events,
		payload: unknown,
	): void {
		try {
			let transformed = this._applyGlobalMiddleware(payload, eventName);
			if (transformed === null) return;

			transformed = this._applyChain(entry.middleware, transformed, eventName);
			if (transformed === null) return;

			const result = entry.handler(transformed, String(eventName));

			if (result instanceof Promise) {
				result.catch((err) =>
					this._reportError(err, String(eventName), entry.id),
				);
			}
		} catch (err) {
			this._reportError(err, String(eventName), entry.id);
		}
	}

	private async _dispatchToAsync(
		entry: SubscriberEntry<unknown>,
		eventName: keyof Events,
		payload: unknown,
	): Promise<void> {
		let transformed = this._applyGlobalMiddleware(payload, eventName);
		if (transformed === null) return;

		transformed = this._applyChain(entry.middleware, transformed, eventName);
		if (transformed === null) return;

		try {
			await entry.handler(transformed, String(eventName));
		} catch (err) {
			this._reportError(err, String(eventName), entry.id);
			throw err;
		}
	}

	private _applyGlobalMiddleware(
		payload: unknown,
		eventName: keyof Events,
	): unknown | null {
		let current: unknown = payload;
		for (const mw of this._globalMiddleware) {
			const result = mw(current, String(eventName));
			if (result === null || result === undefined) return null;
			current = result;
		}
		return current;
	}

	private _applyChain(
		chain: ReadonlyArray<Middleware<unknown>>,
		payload: unknown,
		eventName: keyof Events,
	): unknown | null {
		let current: unknown = payload;
		for (const mw of chain) {
			const result = mw(current, String(eventName));
			if (result === null || result === undefined) return null;
			current = result;
		}
		return current;
	}

	private _reportError(
		error: unknown,
		eventName: string,
		subscriptionId: SubscriptionId,
	): void {
		if (this._onError !== undefined) {
			try {
				this._onError(error, eventName, subscriptionId);
			} catch {
				// Error handler itself must not throw into the dispatch loop.
			}
		}
	}
}
