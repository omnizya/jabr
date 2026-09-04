export interface ImageGenPort {
	generate(prompt: string): Promise<string>;
}


