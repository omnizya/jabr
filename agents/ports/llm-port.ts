export interface LlmRequest {
	prompt: string;
	systemPrompt?: string;
	temperature?: number;
	maxTokens?: number;
	stopSequences?: string[];
}

/** Validates that a temperature value falls within the OpenAI-accepted
 *  range of 0–2.  Returns the value or throws `RangeError` so callers
 *  can fail fast before hitting the API.  Undefined is allowed (adapter
 *  supplies its own default).
 */
export function validateTemperature(t: number | undefined): number | undefined {
	if (t === undefined) return t;
	if (typeof t !== "number" || Number.isNaN(t) || !Number.isFinite(t)) {
		throw new RangeError(`LLM temperature must be a finite number, got ${t}`);
	}
	if (t < 0 || t > 2) {
		throw new RangeError(`LLM temperature must be in [0, 2], got ${t}`);
	}
	return t;
}

export interface LlmResponse {
	text: string;
	usage: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
}

export interface LlmPort {
	generate(request: LlmRequest): Promise<LlmResponse>;
	streamGenerate(
		request: LlmRequest,
		onChunk: (chunk: string) => void,
	): Promise<LlmResponse>;
}

console.log("[LlmPort] port interface loaded");
