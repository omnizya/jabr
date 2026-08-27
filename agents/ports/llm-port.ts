export interface LlmRequest {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
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
  streamGenerate(request: LlmRequest, onChunk: (chunk: string) => void): Promise<LlmResponse>;
}
