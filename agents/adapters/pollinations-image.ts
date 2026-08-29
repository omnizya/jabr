/**
 * Pollinations image generation adapter — implements ImageGenPort using
 * Pollinations.ai's simple URL-based GET API.
 *
 * Usage:
 *   const adapter = new PollinationsImageAdapter({ apiKey, model: "flux" });
 *   const url = await adapter.generate("a cat in space");
 *   // → https://gen.pollinations.ai/image/... (actual generated image)
 */

import type { ImageGenPort } from "@ports/image-gen-port";

export interface PollinationsImageConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export class PollinationsImageAdapter implements ImageGenPort {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: PollinationsImageConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://gen.pollinations.ai").replace(/\/$/, "");
    this.model = config.model ?? "flux";
  }

  async generate(prompt: string): Promise<string> {
    const params = new URLSearchParams({
      model: this.model,
      key: this.apiKey,
    });
    const url = `${this.baseUrl}/image/${encodeURIComponent(prompt)}?${params.toString()}`;

    console.log(`[PollinationsImageAdapter] generating: "${prompt.slice(0, 60)}..." model=${this.model}`);
    const res = await fetch(url);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const msg = `[PollinationsImageAdapter] generate failed: ${res.status} ${res.statusText} ${body}`;
      console.error(msg);
      throw new Error(msg);
    }

    // Pollinations returns the binary image directly on GET; the URL itself
    // is the permanent link to the generated resource.
    return url;
  }
}
