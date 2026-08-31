// adapters/ipfs/ipfs-artifact-adapter.ts
// Concrete adapter: stores artifacts on a local Kubo IPFS node via its HTTP API.
// Implements ArtifactPort — content-addressed by CID, pinned for persistence.

import type { ArtifactPort } from "@ports/artifact-port";

const KUBO_API = "http://127.0.0.1:5001/api/v0";

/** Convert a Kubo API error response into a throwable Error. */
async function throwIfKuboError(res: Response): Promise<void> {
	if (res.ok) return;
	const text = await res.text().catch(() => "");
	throw new Error(`[IpfsArtifactAdapter] Kubo ${res.status}: ${text}`);
}

function formDataWithFile(data: Buffer, name?: string): FormData {
	const fd = new FormData();
	const blob = new Blob([data], { type: "application/octet-stream" });
	fd.append("file", blob, name ?? "artifact");
	return fd;
}

export class IpfsArtifactAdapter implements ArtifactPort {
	async store(
		data: Buffer | string,
		options?: { pin?: boolean; name?: string },
	): Promise<string> {
		const bytes = typeof data === "string" ? Buffer.from(data, "utf-8") : data;

		const res = await fetch(`${KUBO_API}/add`, {
			method: "POST",
			body: formDataWithFile(bytes, options?.name),
		});
		await throwIfKuboError(res);

		const json = (await res.json()) as {
			Hash: string;
			Name: string;
			Size: string;
		};
		const cid = json.Hash;
		if (!cid) throw new Error("[IpfsArtifactAdapter] store returned no CID");

		if (options?.pin) {
			await this.pin(cid);
		}
		return cid;
	}

	async retrieve(cid: string): Promise<Buffer> {
		const res = await fetch(`${KUBO_API}/cat/${cid}`, { method: "POST" });
		await throwIfKuboError(res);
		const buffer = await res.arrayBuffer();
		return Buffer.from(buffer);
	}

	async exists(cid: string): Promise<boolean> {
		const res = await fetch(`${KUBO_API}/cat/${cid}?length=1`, {
			method: "POST",
		});
		// Kubo returns 500 for non-existent/bad CIDs; any non-200 => not found.
		return res.ok;
	}

	async pin(cid: string): Promise<void> {
		const res = await fetch(`${KUBO_API}/pin/add/${cid}?recursive=true`, {
			method: "POST",
		});
		await throwIfKuboError(res);
	}

	async unpin(cid: string): Promise<void> {
		const res = await fetch(`${KUBO_API}/pin/rm/${cid}?recursive=true`, {
			method: "POST",
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			console.warn(
				`[IpfsArtifactAdapter] unpin ${cid} returned ${res.status}: ${text}`,
			);
		}
	}

	async getMetadata(
		cid: string,
	): Promise<{ size: number; name: string; createdAt: Date }> {
		// Size via /block/stat (returns { Key, Size }).
		const sizeRes = await fetch(`${KUBO_API}/block/stat/${cid}`, {
			method: "POST",
		});
		await throwIfKuboError(sizeRes);
		const sizeJson = (await sizeRes.json()) as { Size: string | number };
		const size =
			typeof sizeJson.Size === "string"
				? parseInt(sizeJson.Size, 10)
				: sizeJson.Size;

		// Kubo doesn't retain the user-supplied pinname in a retrievable endpoint,
		// so fall back to the CID string when no name is available.
		return { size, name: cid, createdAt: new Date() };
	}
}
