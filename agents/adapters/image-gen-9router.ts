import type { ImageGenPort } from "@ports/image-gen-port";

interface NineRouterImageResponse {
	data?: Array<{ url?: string; b64_json?: string }>;
	error?: { message?: string };
}

/** 9Router HTTP adapter for image generation (OpenAI-compatible endpoint). */
export class ImageGen9Router implements ImageGenPort {
	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly model: string;
	private readonly size?: string;

	constructor(opts?: {
		baseUrl?: string;
		apiKey?: string;
		model?: string;
		size?: string;
	}) {
		this.baseUrl =
			opts?.baseUrl ?? process.env.NINEROUTER_URL ?? "http://127.0.0.1:20128";
		this.apiKey =
			opts?.apiKey ??
			process.env.NINEROUTER_KEY ??
			"sk-ac4453b102b24d2f-9eda9y-838fcb60";
		this.model = opts?.model ?? "gemini/gemini-3-pro-image-preview";
		this.size = opts?.size;
	}

	async generate(prompt: string): Promise<string> {
		const payload: Record<string, unknown> = {
			model: this.model,
			prompt,
		};
		if (this.size) {
			payload.size = this.size;
		}

		try {
			const res = await fetch(`${this.baseUrl}/v1/images/generations`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify(payload),
			});

			if (!res.ok) {
				const msg = `[ImageGen9Router] generate failed: ${res.status} ${res.statusText}`;
				console.error(msg);
				throw new Error(msg);
			}

			const data = (await res.json()) as NineRouterImageResponse;

			if (data.error?.message) {
				const msg = `[ImageGen9Router] API error: ${data.error.message}`;
				console.error(msg);
				throw new Error(msg);
			}

			const item = data.data?.[0];
			if (item?.url) {
				return item.url;
			}
			if (item?.b64_json) {
				return `data:image/png;base64,${item.b64_json}`;
			}

			throw new Error("[ImageGen9Router] no image URL in response");
		} catch (err) {
			const msg = `[ImageGen9Router] generate error: ${String(err)}`;
			console.error(msg, err);
			throw new Error(msg);
		}
	}
}
