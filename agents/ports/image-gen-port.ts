export interface ImageGenPort {
	generate(prompt: string): Promise<string>;
}

console.log("[ImageGenPort] port interface loaded");
