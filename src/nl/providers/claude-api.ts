import type { LLMProvider } from "../provider-registry.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const API_URL = "https://api.anthropic.com/v1/messages";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createClaudeApiProvider(
  apiKey: string,
  model: string = DEFAULT_MODEL,
): LLMProvider {
  return {
    name: "claude",
    run: async (prompt: string): Promise<string> => {
      let lastError: unknown;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let response: Response;
        try {
          response = await fetch(API_URL, {
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
            signal: controller.signal,
          });
        } catch (err) {
          clearTimeout(timeout);
          if ((err as { name?: string }).name === "AbortError") {
            throw new Error("AI provider request timed out after 60 seconds");
          }
          // Network errors are retryable
          lastError = err;
          if (attempt < MAX_ATTEMPTS) {
            await sleep(Math.pow(2, attempt - 1) * 1000);
          }
          continue;
        }
        clearTimeout(timeout);

        if (!response.ok) {
          if (isRetryableStatus(response.status) && attempt < MAX_ATTEMPTS) {
            lastError = new Error(`Anthropic API error (${response.status})`);
            await sleep(Math.pow(2, attempt - 1) * 1000);
            continue;
          }
          const errorBody = await response.text();
          throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
        }

        const data = (await response.json()) as {
          content: Array<{ type: string; text: string }>;
        };

        const textBlock = data.content?.find((c) => c.type === "text");
        if (!textBlock) {
          throw new Error("Anthropic API returned no text content");
        }

        return textBlock.text;
      }

      throw lastError ?? new Error("Anthropic API request failed after retries");
    },
  };
}
