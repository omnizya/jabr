// ports/artifact-port.ts
// Hexagonal port: artifact storage contract.
// Adapters implement this (e.g. IpfsArtifactAdapter.ts).
// Artifact references are stored as CID strings in task records.

export interface ArtifactPort {
	// Store artifact, returns CID
	store(
		data: Buffer | string,
		options?: { pin?: boolean; name?: string },
	): Promise<string>;

	// Retrieve artifact by CID
	retrieve(cid: string): Promise<Buffer>;

	// Check if artifact exists
	exists(cid: string): Promise<boolean>;

	// Pin artifact (ensure persistence)
	pin(cid: string): Promise<void>;

	// Unpin artifact (allow GC)
	unpin(cid: string): Promise<void>;

	// Get artifact metadata
	getMetadata(
		cid: string,
	): Promise<{ size: number; name: string; createdAt: Date }>;
}


