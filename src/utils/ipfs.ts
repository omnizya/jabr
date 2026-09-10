/**
 * Convert a Kubo API error response into a throwable Error.
 * @param Response
 * @returns Promise<void>
 */
export async function throwIfKuboError(res: Response): Promise<void> {
	if (res.ok) return;
	const text = await res.text().catch(() => "");
	throw new Error(`[IpfsArtifactAdapter] Kubo ${res.status}: ${text}`);
}
