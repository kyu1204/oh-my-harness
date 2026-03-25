import type { LLMProvider } from "../provider-registry.js";

const DEFAULT_MODEL = "gemini-2.5-flash";

function getApiUrl(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

export function createGeminiApiProvider(
  apiKey: string,
  model: string = DEFAULT_MODEL,
): LLMProvider {
  return {
    name: "gemini",
    run: async (prompt: string): Promise<string> => {
      const response = await fetch(getApiUrl(model, apiKey), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 4096,
          },
        }),
      });

      if (!response.ok) {
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
    },
  };
}
