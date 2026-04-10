import type { LLMProvider } from "../provider-registry.js";

const DEFAULT_MODEL = "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;

function getApiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGeminiApiProvider(
  apiKey: string,
  model: string = DEFAULT_MODEL,
): LLMProvider {
  return {
    name: "gemini",
    run: async (prompt: string): Promise<string> => {
      let lastError: unknown;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let response: Response;
        try {
          response = await fetch(getApiUrl(model), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                maxOutputTokens: 4096,
              },
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
            lastError = new Error(`Gemini API error (${response.status})`);
            await sleep(Math.pow(2, attempt - 1) * 1000);
            continue;
          }
          const errorBody = await response.text();
          throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
        }

        const data = (await response.json()) as {
          candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
        };

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error("Gemini API returned no content");
        }

        return text;
      }

      throw lastError ?? new Error("Gemini API request failed after retries");
    },
  };
}
