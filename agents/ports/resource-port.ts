export interface ResourcePort {
	listResources(): Promise<
		Array<{
			uri: string;
			name: string;
			description?: string;
			mimeType?: string;
		}>
	>;
	readResource(
		uri: string,
	): Promise<
		Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>
	>;
}

console.log("[ResourcePort] port interface loaded");
