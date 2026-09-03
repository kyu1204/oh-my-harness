import type { LLMProvider } from "../provider-registry.js";

const DEFAULT_MODEL = "gpt-5.6-sol";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface OpenaiApiProviderOptions {
  /** API root; anything OpenAI-compatible (Ollama, llama.cpp, MLX, LM Studio, routers). */
  baseUrl?: string;
  /** Provider name reported on the LLMProvider. */
  name?: string;
  /** Extra request headers (e.g. OpenRouter attribution). */
  headers?: Record<string, string>;
}
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

/**
 * Returns an error message when the base URL is unusable, or undefined.
 * Plain http is fine for loopback (Ollama etc.), but an API key must never
 * travel in cleartext to a remote host.
 */
export function validateBaseUrl(raw: string, apiKey?: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "Must be a valid URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Must start with http:// or https://";
  if (!url.hostname) return "URL must include a host";
  if (url.protocol === "http:" && apiKey && !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    return "Use https:// when sending an API key to a remote host";
  }
  return undefined;
}

export function createOpenaiApiProvider(
  apiKey: string,
  model: string = DEFAULT_MODEL,
  options: OpenaiApiProviderOptions = {},
): LLMProvider {
  const baseUrl = (options.baseUrl ?? OPENAI_BASE_URL).replace(/\/+$/, "");
  const invalid = validateBaseUrl(baseUrl, apiKey);
  if (invalid) throw new Error(`Invalid base URL "${baseUrl}": ${invalid}`);
  const url = `${baseUrl}/chat/completions`;
  const isOpenai = baseUrl === OPENAI_BASE_URL;
  const headers: Record<string, string> = { "Content-Type": "application/json", ...options.headers };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  // OpenAI rejects max_tokens on reasoning models; most local servers still expect it.
  const tokenLimit = isOpenai ? { max_completion_tokens: 4096 } : { max_tokens: 4096 };

  return {
    name: options.name ?? "openai",
    run: async (prompt: string): Promise<string> => {
      let lastError: unknown;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let response: Response;
        try {
          response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: prompt }],
              ...tokenLimit,
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

        // Keep the timeout armed until the body is fully read: fetch() resolves
        // on headers, and a stalled body would otherwise hang forever.
        try {
          if (!response.ok) {
            if (isRetryableStatus(response.status) && attempt < MAX_ATTEMPTS) {
              lastError = new Error(`OpenAI API error (${response.status})`);
              clearTimeout(timeout);
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
        } catch (err) {
          if ((err as { name?: string }).name === "AbortError") {
            throw new Error("AI provider request timed out after 60 seconds");
          }
          throw err;
        } finally {
          clearTimeout(timeout);
        }
      }

      throw lastError ?? new Error("OpenAI API request failed after retries");
    },
  };
}
