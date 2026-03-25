import type { LLMProvider } from "../provider-registry.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const API_URL = "https://api.anthropic.com/v1/messages";

export function createClaudeApiProvider(
  apiKey: string,
  model: string = DEFAULT_MODEL,
): LLMProvider {
  return {
    name: "claude",
    run: async (prompt: string): Promise<string> => {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text: string }>;
      };

      const textBlock = data.content.find((c) => c.type === "text");
      if (!textBlock) {
        throw new Error("Anthropic API returned no text content");
      }

      return textBlock.text;
    },
  };
}
