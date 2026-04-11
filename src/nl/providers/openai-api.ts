import type { LLMProvider } from "../provider-registry.js";

const DEFAULT_MODEL = "gpt-5.4";
const API_URL = "https://api.openai.com/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createOpenaiApiProvider(
  apiKey: string,
  model: string = DEFAULT_MODEL,
): LLMProvider {
  return {
    name: "openai",
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
              "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: prompt }],
              max_completion_tokens: 4096,
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
            lastError = new Error(`OpenAI API error (${response.status})`);
            await sleep(Math.pow(2, attempt - 1) * 1000);
            continue;
          }
          const errorBody = await response.text();
          throw new Error(`OpenAI API error (${response.status}): ${errorBody}`);
        }

        const data = (await response.json()) as {
          choices: Array<{ message: { content: string } }>;
        };

        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error("Empty response from OpenAI");
        }

        return content;
      }

      throw lastError ?? new Error("OpenAI API request failed after retries");
    },
  };
}
