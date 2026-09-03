import { describe, it, expect, vi, afterEach } from "vitest";
import { listModels } from "../../src/nl/list-models.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listModels", () => {
  it("lists OpenAI-compatible models from GET {baseUrl}/models", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [{ id: "llama3.2" }, { id: "qwen2.5" }] })));

    const ids = await listModels("openai-compatible", { baseUrl: "http://localhost:11434/v1/" });

    expect(ids).toEqual(["llama3.2", "qwen2.5"]);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/models");
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("lists OpenAI models with the bearer key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [{ id: "gpt-5.5" }] })));

    const ids = await listModels("openai", { apiKey: "sk-x" });

    expect(ids).toEqual(["gpt-5.5"]);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/models");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-x");
  });

  it("lists OpenRouter models from openrouter.ai", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [{ id: "openai/gpt-oss-120b:free" }] })));

    const ids = await listModels("openrouter", { apiKey: "sk-or" });

    expect(ids).toEqual(["openai/gpt-oss-120b:free"]);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/models");
  });

  it("lists Claude models via x-api-key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [{ id: "claude-opus-5" }, { id: "claude-sonnet-5" }] })));

    const ids = await listModels("claude", { apiKey: "sk-ant" });

    expect(ids).toEqual(["claude-opus-5", "claude-sonnet-5"]);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/models");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant");
    expect(headers["anthropic-version"]).toBeTruthy();
  });

  it("lists Gemini models that support generateContent, stripping the models/ prefix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          models: [
            { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
            { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
          ],
        }),
      ),
    );

    const ids = await listModels("gemini", { apiKey: "g-key" });

    expect(ids).toEqual(["gemini-2.5-pro"]);
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("generativelanguage.googleapis.com");
    expect(String(url)).not.toContain("g-key");
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "nope" }, 401)));

    await expect(listModels("openai", { apiKey: "bad" })).rejects.toThrow("401");
  });

  it("throws for providers without a model listing endpoint", async () => {
    await expect(listModels("codex", {})).rejects.toThrow();
  });
});
