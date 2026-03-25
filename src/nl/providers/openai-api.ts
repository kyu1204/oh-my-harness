import type { LLMProvider } from "../provider-registry.js";

const DEFAULT_MODEL = "gpt-4o";
const API_URL = "https://api.openai.com/v1/chat/completions";

export function createOpenaiApiProvider(
  apiKey: string,
  model: string = DEFAULT_MODEL,
): LLMProvider {
  return {
    name: "openai",
    run: async (prompt: string): Promise<string> => {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 4096,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${errorBody}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      if (!data.choices?.[0]?.message?.content) {
        throw new Error("OpenAI API returned no content");
      }

      return data.choices[0].message.content;
    },
  };
}
