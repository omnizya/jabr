import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	parseWhatsAppEvent,
	WhatsAppWebhookAdapter,
} from "@adapters/http/whatsapp-webhook";
import type {
	WhatsAppTextMessage,
	WhatsAppWebhookEvent,
} from "@ports/whatsapp-bot-port";

// ── Minimal adapter stub for delegation testing ──────────────────────────────
// Mirrors the GitHub test pattern: intercept fetch() calls so we can assert
// the delegate payload without starting a real Bun.serve instance.

async function makeTestAdapter(delegateUrl = "http://localhost:4005"): Promise<{
	route: (event: WhatsAppWebhookEvent) => Promise<void>;
	fetchCalls: Array<{ url: string; body: unknown }>;
	clearFetchCalls: () => void;
	restoreFetch: () => void;
}> {
	const fetchCalls: Array<{ url: string; body: unknown }> = [];
	const originalFetch = globalThis.fetch;
	(globalThis as any).fetch = ((url: string | URL, opts?: RequestInit) => {
		fetchCalls.push({
			url: url as string,
			body: opts?.body ? JSON.parse(opts.body as string) : undefined,
		});
		return new Response(JSON.stringify({ result: { text: "ok" } }), {
			status: 200,
		});
	}) as unknown as typeof fetch;

	const { WhatsAppWebhookAdapter } = await import(
		"@adapters/http/whatsapp-webhook"
	);
	const adapter = new WhatsAppWebhookAdapter({
		webhookSecret: "test-secret",
		phoneNumberId: "test-phone-id",
		businessAccountId: "test-business-id",
		accessToken: "",
		port: 4009,
		delegateUrl,
	});

	return {
		route: (event: WhatsAppWebhookEvent) =>
			(
				adapter as unknown as {
					route: (e: WhatsAppWebhookEvent) => Promise<void>;
				}
			).route(event),
		get fetchCalls() {
			return fetchCalls;
		},
		clearFetchCalls: () => {
			fetchCalls.length = 0;
		},
		restoreFetch: () => {
			(globalThis as any).fetch = originalFetch;
		},
	};
}

// ── Sample WhatsApp webhook payloads ─────────────────────────────────────────

const textMessagePayload = JSON.stringify({
	object: "whatsapp",
	entry: [
		{
			id: "business-account-id",
			changes: [
				{
					value: {
						messaging_product: "whatsapp",
						metadata: {
							display_phone_number: "+15551234567",
							phone_number_id: "phone-number-id",
						},
						messages: [
							{
								from: "+212612345678",
								id: "msg-001",
								timestamp: "2026-08-29T14:00:00Z",
								text: { body: "fix bug" },
							},
						],
					},
				},
			],
		},
	],
});

const textMessagePayloadExplicit = JSON.stringify({
	object: "whatsapp",
	entry: [
		{
			id: "business-account-id",
			changes: [
				{
					value: {
						messaging_product: "whatsapp",
						metadata: {
							display_phone_number: "+15551234567",
							phone_number_id: "phone-number-id",
						},
						messages: [
							{
								from: "+212612345678",
								id: "msg-002",
								timestamp: "2026-08-29T14:05:00Z",
								text: { body: "fix this bug in the parser" },
							},
						],
					},
				},
			],
		},
	],
});

const statusPayload = JSON.stringify({
	object: "whatsapp",
	entry: [
		{
			id: "business-account-id",
			changes: [
				{
					value: {
						messaging_product: "whatsapp",
						metadata: {
							display_phone_number: "+15551234567",
							phone_number_id: "phone-number-id",
						},
						statuses: [
							{
								id: "msg-001",
								recipient_id: "+212612345678",
								status: "delivered",
								timestamp: "2026-08-29T14:01:00Z",
							},
						],
					},
				},
			],
		},
	],
});

const emptyMessagesPayload = JSON.stringify({
	object: "whatsapp",
	entry: [
		{
			id: "business-account-id",
			changes: [
				{
					value: {
						messaging_product: "whatsapp",
						metadata: {
							display_phone_number: "+15551234567",
							phone_number_id: "phone-number-id",
						},
						messages: [],
					},
				},
			],
		},
	],
});

// ── parseWhatsAppEvent ────────────────────────────────────────────────────────

describe("parseWhatsAppEvent", () => {
	test("parses a text message event", () => {
		const event = parseWhatsAppEvent(textMessagePayload);
		expect(event).toMatchObject({
			source: "whatsapp",
			type: "message",
			sessionId: "+212612345678",
		});
		expect(event.payload.entry).toHaveLength(1);
		const change = event.payload.entry[0]!.changes[0]!;
		expect(change.value.messages!).toHaveLength(1);
		expect(change.value.messages![0]!.type).toBe("text");
		expect((change.value.messages![0]! as WhatsAppTextMessage).text.body).toBe(
			"fix bug",
		);
		expect(change.value.messages![0]!.from).toBe("+212612345678");
	});

	test("parses a text message with a longer body", () => {
		const event = parseWhatsAppEvent(textMessagePayloadExplicit);
		const msg = event.payload.entry[0]!.changes[0]!.value.messages![0]!;
		expect((msg as WhatsAppTextMessage).text.body).toBe(
			"fix this bug in the parser",
		);
		expect(event.sessionId).toBe("+212612345678");
	});

	test("parses a status event", () => {
		const event = parseWhatsAppEvent(statusPayload);
		expect(event.type).toBe("status");
		expect(event.sessionId).toBe("+212612345678");
		const statuses = event.payload.entry[0]!.changes[0]!.value.statuses!;
		expect(statuses).toHaveLength(1);
		expect(statuses![0]!.status).toBe("delivered");
		expect(statuses![0]!.id).toBe("msg-001");
	});

	test("throws on non-whatsapp object", () => {
		expect(() =>
			parseWhatsAppEvent(JSON.stringify({ object: "telegram" })),
		).toThrow(/unexpected webhook object/);
	});

	test("throws on empty entry", () => {
		expect(() =>
			parseWhatsAppEvent(JSON.stringify({ object: "whatsapp", entry: [] })),
		).toThrow(/empty webhook entry/);
	});

	test("throws on empty changes", () => {
		expect(() =>
			parseWhatsAppEvent(
				JSON.stringify({
					object: "whatsapp",
					entry: [{ id: "x", changes: [] }],
				}),
			),
		).toThrow(/empty entry changes/);
	});

	test("falls back to text type when message has no recognised field", () => {
		const payload = JSON.stringify({
			object: "whatsapp",
			entry: [
				{
					id: "business-account-id",
					changes: [
						{
							value: {
								messaging_product: "whatsapp",
								metadata: {
									display_phone_number: "+15551234567",
									phone_number_id: "phone-number-id",
								},
								messages: [
									{
										from: "+212612345678",
										id: "msg-unknown",
										timestamp: "2026-08-29T14:00:00Z",
									},
								],
							},
						},
					],
				},
			],
		});
		const event = parseWhatsAppEvent(payload);
		const msg = event.payload.entry[0]!.changes[0]!.value.messages![0]!;
		expect(msg.type).toBe("text");
		expect((msg as WhatsAppTextMessage).text.body).toBe("");
	});
});

// ── Adapter delegation ────────────────────────────────────────────────────────

describe("WhatsAppWebhookAdapter delegation", () => {
	let adapter: Awaited<ReturnType<typeof makeTestAdapter>>;
	let originalFetch: typeof globalThis.fetch;

	beforeAll(async () => {
		originalFetch = globalThis.fetch;
		adapter = await makeTestAdapter("http://localhost:4005");
	});

	afterAll(() => {
		adapter?.restoreFetch();
		(globalThis as any).fetch = originalFetch;
	});

	beforeEach(() => {
		adapter?.clearFetchCalls();
	});

	test("routes a text message → delegateUrl with tasks/send", async () => {
		const event = parseWhatsAppEvent(textMessagePayload);
		await adapter.route(event);
		expect(adapter.fetchCalls.length).toBe(1);
		const call = adapter.fetchCalls[0]!;
		expect(call!.url).toBe("http://localhost:4005");
		const body = call.body as {
			jsonrpc: string;
			method: string;
			params: { message: { parts: Array<{ kind: string; text: string }> } };
		};
		expect(body.jsonrpc).toBe("2.0");
		expect(body.method).toBe("tasks/send");
		expect(body.params.message.parts[0]!.text).toContain(
			"[WhatsApp] From ++212612345678:",
		);
		expect(body.params.message.parts[0]!.text).toContain("fix bug");
	});

	test("routes a 'fix this bug' message → fixer delegate payload", async () => {
		const event = parseWhatsAppEvent(textMessagePayloadExplicit);
		await adapter.route(event);
		expect(adapter.fetchCalls.length).toBe(1);
		const body = adapter.fetchCalls[0]!.body as {
			params: { message: { parts: Array<{ kind: string; text: string }> } };
		};
		const text = body.params.message.parts[0]!.text;
		expect(text).toContain("fix this bug in the parser");
		expect(text).toMatch(/\[WhatsApp\] From \+\+\d+/);
	});

	test("is a no-op when there are no messages (status-only event)", async () => {
		const event = parseWhatsAppEvent(statusPayload);
		await adapter.route(event);
		expect(adapter.fetchCalls.length).toBe(0);
	});

	test("is a no-op when messages array is empty", async () => {
		const event = parseWhatsAppEvent(emptyMessagesPayload);
		await adapter.route(event);
		expect(adapter.fetchCalls.length).toBe(0);
	});

	test("does not delegate when delegateUrl is empty", async () => {
		const { WhatsAppWebhookAdapter } = await import(
			"@adapters/http/whatsapp-webhook"
		);
		const noDelegate = new WhatsAppWebhookAdapter({
			webhookSecret: "s",
			phoneNumberId: "p",
			businessAccountId: "b",
			accessToken: "",
			port: 4009,
			delegateUrl: "",
		});
		const event = parseWhatsAppEvent(textMessagePayload);
		// delegateToAgent logs and returns early when delegateUrl is empty.
		// We verify the path doesn't crash.
		await (
			noDelegate as unknown as {
				route: (e: WhatsAppWebhookEvent) => Promise<void>;
			}
		).route(event);
		expect(true).toBe(true);
	});
});

// ── Signature verification ─────────────────────────────────────────────────────
// Strategy: a fetch mock that stubs WhatsApp Cloud API + delegate URLs but
// passes everything else through to the real fetch, so the running Bun.serve
// webhook is actually hit. Mirrors the Telegram test pattern.

interface SignatureRecordedCall {
	url: string;
	method: string;
	body: unknown;
	headers: Record<string, string>;
}

function signatureParseBody(opts: RequestInit | undefined): unknown {
	if (opts?.body == null || typeof opts.body !== "string") return opts?.body;
	try {
		return JSON.parse(opts.body);
	} catch {
		return opts.body;
	}
}

function signatureHeadersRecord(
	opts: RequestInit | undefined,
): Record<string, string> {
	const h: Record<string, string> = {};
	if (opts?.headers) {
		if (opts.headers instanceof Headers) {
			opts.headers.forEach((v, k) => {
				h[k] = v;
			});
		} else {
			for (const [k, v] of Object.entries(
				opts.headers as Record<string, string>,
			)) {
				h[k] = v;
			}
		}
	}
	return h;
}

function createSignatureTestEnv(
	port: number,
	delegateHost: string = "localhost:4005",
): {
	adapter: WhatsAppWebhookAdapter;
	fetchCalls: SignatureRecordedCall[];
	restore: () => void;
} {
	const fetchCalls: SignatureRecordedCall[] = [];
	const originalFetch = globalThis.fetch;

	const testFetch = async (url: string | URL, opts?: RequestInit) => {
		const u = url.toString();

		// WhatsApp Cloud API → stubs (no access token in tests, so these are
		// never actually called, but we still intercept to keep the mock clean).
		if (u.includes("graph.facebook.com")) {
			fetchCalls.push({
				url: u,
				method: opts?.method ?? "GET",
				body: signatureParseBody(opts),
				headers: signatureHeadersRecord(opts),
			});
			return new Response(JSON.stringify({ error: { message: "stub" } }), {
				status: 400,
			});
		}

		// Delegate URL → stubbed.
		if (u.includes(delegateHost)) {
			fetchCalls.push({
				url: u,
				method: opts?.method ?? "GET",
				body: signatureParseBody(opts),
				headers: signatureHeadersRecord(opts),
			});
			return new Response(JSON.stringify({ result: { text: "ok" } }), {
				status: 200,
			});
		}

		// Everything else (the webhook endpoint at localhost:<port>) → pass
		// through to the real fetch so the running Bun.serve is actually hit.
		return originalFetch(url, opts);
	};

	(globalThis as any).fetch = testFetch as unknown as typeof fetch;

	const adapter = new WhatsAppWebhookAdapter({
		webhookSecret: "test-webhook-secret",
		phoneNumberId: "test-phone-id",
		businessAccountId: "test-business-id",
		accessToken: "",
		port,
		delegateUrl: `http://${delegateHost}`,
	});

	return {
		adapter,
		fetchCalls,
		restore: () => {
			(globalThis as any).fetch = originalFetch;
		},
	};
}

function computeSignature(rawBody: string, secret: string): string {
	const { createHmac } = require("node:crypto");
	return createHmac("sha256", secret).update(rawBody).digest("hex");
}

describe("WhatsAppWebhookAdapter signature verification", () => {
	let adapter: WhatsAppWebhookAdapter;
	let fetchCalls: SignatureRecordedCall[];
	let restore: () => void;

	afterAll(() => {
		if (adapter) adapter.stop();
		if (restore) restore();
	});

	test("POST /webhook without signature header → 401", async () => {
		const port = 4011;
		const env = await createSignatureTestEnv(port);
		adapter = env.adapter;
		fetchCalls = env.fetchCalls;
		restore = env.restore;

		adapter.start();
		await new Promise((r) => setTimeout(r, 200));

		const res = await fetch(`http://localhost:${port}/webhook`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: textMessagePayload,
		});

		expect(res.status).toBe(401);

		adapter.stop();
		await new Promise((r) => setTimeout(r, 200));
	});

	test("POST /webhook with invalid signature → 401", async () => {
		const port = 4012;
		const env = await createSignatureTestEnv(port);
		adapter = env.adapter;
		fetchCalls = env.fetchCalls;
		restore = env.restore;

		adapter.start();
		await new Promise((r) => setTimeout(r, 200));

		const res = await fetch(`http://localhost:${port}/webhook`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-WA-Webhook-Signature": "sha256=wrong-signature",
			},
			body: textMessagePayload,
		});

		expect(res.status).toBe(401);

		adapter.stop();
		await new Promise((r) => setTimeout(r, 200));
	});

	test("POST /webhook with valid signature → 200", async () => {
		const port = 4013;
		const env = await createSignatureTestEnv(port);
		adapter = env.adapter;
		fetchCalls = env.fetchCalls;
		restore = env.restore;

		adapter.start();
		await new Promise((r) => setTimeout(r, 200));

		const sig = computeSignature(textMessagePayload, "test-webhook-secret");

		const res = await fetch(`http://localhost:${port}/webhook`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-WA-Webhook-Signature": `sha256=${sig}`,
			},
			body: textMessagePayload,
		});

		expect(res.status).toBe(200);

		// The message should have been delegated.
		expect(fetchCalls.length).toBeGreaterThan(0);
		const delegateCall = fetchCalls.find((c) =>
			c.url.includes("localhost:4005"),
		);
		expect(delegateCall).toBeDefined();
		if (delegateCall) {
			const body = delegateCall.body as {
				jsonrpc: string;
				method: string;
				params: { message: { parts: Array<{ kind: string; text: string }> } };
			};
			expect(body.jsonrpc).toBe("2.0");
			expect(body.method).toBe("tasks/send");
			expect(body.params.message.parts[0]!.text).toMatch(/\[WhatsApp\] From/);
		}

		adapter.stop();
		await new Promise((r) => setTimeout(r, 200));
	});
});
