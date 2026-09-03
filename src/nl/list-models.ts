import { OPENAI_BASE_URL } from "./providers/openai-api.js";

export interface ListModelsOptions {
  apiKey?: string;
  baseUrl?: string;
}

const TIMEOUT_MS = 10_000;

async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Model listing failed (${response.status})`);
  }
  return (await response.json()) as T;
}

async function listOpenaiStyle(baseUrl: string, apiKey?: string): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const data = await getJson<{ data?: Array<{ id: string }> }>(`${baseUrl.replace(/\/+$/, "")}/models`, headers);
  return (data.data ?? []).map((m) => m.id);
}

/**
 * Fetches the live model list for a provider so the picker never depends on a
 * hardcoded catalogue. Throws when the provider has no listing endpoint or the
 * request fails; callers fall back to the static list.
 */
export async function listModels(provider: string, options: ListModelsOptions): Promise<string[]> {
  switch (provider) {
    case "openai":
      return listOpenaiStyle(OPENAI_BASE_URL, options.apiKey);
    case "openai-compatible": {
      if (!options.baseUrl) throw new Error("baseUrl is required to list models");
      return listOpenaiStyle(options.baseUrl, options.apiKey);
    }
    case "claude": {
      const data = await getJson<{ data?: Array<{ id: string }> }>("https://api.anthropic.com/v1/models", {
        "x-api-key": options.apiKey ?? "",
        "anthropic-version": "2023-06-01",
      });
      return (data.data ?? []).map((m) => m.id);
    }
    case "gemini": {
      const data = await getJson<{
        models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
      }>("https://generativelanguage.googleapis.com/v1beta/models", { "x-goog-api-key": options.apiKey ?? "" });
      return (data.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""));
    }
    default:
      throw new Error(`Provider "${provider}" has no model listing endpoint`);
  }
}
