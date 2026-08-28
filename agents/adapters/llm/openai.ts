import type { LlmPort, LlmRequest, LlmResponse } from "@agents/ports/llm-port";
import type { BudgetPort } from "@ports/budget-port";

export class OpenAiLlmAdapter implements LlmPort {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(
    private budget?: BudgetPort,
    opts?: { baseUrl?: string; apiKey?: string; model?: string },
  ) {
    this.apiKey = opts?.apiKey ?? process.env.JABR_OPENAI_API_KEY ?? "";
    this.baseUrl = opts?.baseUrl ?? process.env.JABR_OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    this.model = opts?.model ?? process.env.JABR_OPENAI_MODEL ?? "gpt-4o";
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: request.systemPrompt || "" },
          { role: "user", content: request.prompt },
        ],
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens,
        stop: request.stopSequences,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API Error: ${response.status} ${await response.text()}`);
    }

    // 9router appends a streaming `data: [DONE]` sentinel to non-stream
    // responses, and Bun's res.json() rejects leading whitespace — so
    // extract the JSON object between the first `{` and last `}`.
    const raw = await response.text();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error(`LLM API Error: invalid JSON response: ${raw.slice(0, 200)}`);
    }
    const data = JSON.parse(raw.slice(start, end + 1)) as any;
    const choice = data.choices[0];

    if (this.budget) {
      await this.budget.consume("openai", data.usage.total_tokens);
    }

    return {
      text: choice.message.content,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }

  async streamGenerate(request: LlmRequest, onChunk: (chunk: string) => void): Promise<LlmResponse> {
    // Stream implementation for provider-agnostic support
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: request.systemPrompt || "" },
          { role: "user", content: request.prompt },
        ],
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens,
        stop: request.stopSequences,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API Error: ${response.status} ${await response.text()}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let usage: any = {};

    if (!reader) throw new Error("No response body");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((line) => line.trim());
      
      for (const line of lines) {
        const trimmed = line.replace(/^data: /, "").trim();
        if (trimmed === "[DONE]") continue;
        try {
          const parsed = JSON.parse(trimmed);
          const content = parsed.choices[0]?.delta?.content;
          if (content) {
            fullText += content;
            onChunk(content);
          }
          if (parsed.usage) usage = parsed.usage;
        } catch (e) {
          // Ignore partial JSON chunks
        }
      }
    }

    if (this.budget) {
      await this.budget.consume("openai", usage.total_tokens || 0);
    }

    return {
      text: fullText,
      usage: {
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
      },
    };
  }
}
