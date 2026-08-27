/**
 * Outbound port: generate images from a text prompt via an image-generation
 * provider. Adapter: 9Router HTTP API (image-gen-9router.ts).
 */
export interface ImageGenPort {
  /** Generate an image for the given prompt and return its URL. */
  generate(prompt: string): Promise<string>;
}
