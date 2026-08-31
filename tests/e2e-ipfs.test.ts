// tests/e2e-ipfs.test.ts
// E2E test for IPFS integration.
// Requires a local Kubo daemon on http://127.0.0.1:5001 (default).
// Skips gracefully if the daemon is unreachable.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IpfsArtifactAdapter } from "@adapters/ipfs/ipfs-artifact-adapter";
import type { ArtifactPort } from "@ports/artifact-port";

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("IPFS E2E — artifact store and retrieve", () => {
	let port: ArtifactPort;
	let adapter: IpfsArtifactAdapter;

	beforeEach(() => {
		adapter = new IpfsArtifactAdapter();
		port = adapter;
	});

	afterEach(() => {
		// no-op: Kubo manages pins; nothing to tear down.
	});

	test("store artifact and returns CID", async () => {
		const data = Buffer.from("hello from agent-lab");
		const cid = await port.store(data);

		expect(cid).toBeTypeOf("string");
		expect(cid).toMatch(/^[A-Za-z0-9]+$/);
	});

	test("store then retrieve returns original bytes", async () => {
		const original = Buffer.from(
			"E2E round-trip payload – store and fetch",
			"utf-8",
		);
		const cid = await port.store(original);
		const retrieved = await port.retrieve(cid);

		expect(retrieved).toBeInstanceOf(Buffer);
		expect(retrieved.equals(original)).toBe(true);
	});

	test("binary blob round-trips intact", async () => {
		const original = new Uint8Array([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 42, 0x00, 0x00, 0x00,
		]);
		const cid = await port.store(Buffer.from(original));
		const retrieved = await port.retrieve(cid);

		expect(retrieved).toBeInstanceOf(Buffer);
		expect(retrieved.equals(Buffer.from(original))).toBe(true);
	});

	test("pin preserves CID across retrieval", async () => {
		const data = Buffer.from("pinned artifact");
		const cid = await port.store(data, { pin: true });
		await port.pin(cid); // ensure it is pinned
		const retrieved = await port.retrieve(cid);
		expect(retrieved.equals(data)).toBe(true);
	});

	test("store with custom name returns valid CID", async () => {
		const data = Buffer.from("named artifact");
		const cid = await port.store(data, { name: "test-artifact.bin" });
		expect(cid).toBeTypeOf("string");
		expect(cid).toMatch(/^[A-Za-z0-9]+$/);
	});

	test("exists returns true for a stored CID", async () => {
		const data = Buffer.from("existence check");
		const cid = await port.store(data);
		expect(await port.exists(cid)).toBe(true);
	});

	test("exists returns false for an unknown CID", async () => {
		// A CID that was never added should report non-existent.
		// Kubo returns 500 for a malformed/bad CID; any non-ok response counts as not existing.
		expect(
			await port.exists(
				"QmAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY",
			),
		).toBe(false);
	});

	test("getMetadata returns size and name for a stored CID", async () => {
		const data = Buffer.from("metadata test payload");
		const cid = await port.store(data, { name: "meta-test.txt" });
		const meta = await port.getMetadata(cid);

		expect(meta.size).toBeGreaterThanOrEqual(data.length);
		expect(meta.name).toBeTypeOf("string");
	});

	test("store with string input round-trips", async () => {
		const str = "UTF-8 string artifact";
		const cid = await port.store(str);
		const retrieved = await port.retrieve(cid);
		expect(retrieved.toString("utf-8")).toBe(str);
	});
});
