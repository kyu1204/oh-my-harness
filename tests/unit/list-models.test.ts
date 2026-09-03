import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

  it("refuses to send an API key to a remote http endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(listModels("openai-compatible", { baseUrl: "http://10.0.0.5:8000/v1", apiKey: "sk-x" })).rejects.toThrow(/https/i);
    expect(fetch).not.toHaveBeenCalled();
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

  it("lists Codex models live when an OAuth session is given, listed+api-supported only, by priority", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          models: [
            { slug: "gpt-5.5", visibility: "list", priority: 7, supported_in_api: true },
            { slug: "gpt-reserve", visibility: "hide", priority: 3, supported_in_api: true },
            { slug: "gpt-5.6-sol", visibility: "list", priority: 1, supported_in_api: true },
          ],
        }),
      ),
    );

    const ids = await listModels("codex", { codexAuth: { accessToken: "tok", accountId: "acc" } });

    expect(ids).toEqual(["gpt-5.6-sol", "gpt-5.5"]);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/models");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["ChatGPT-Account-ID"]).toBe("acc");
  });

  it("falls back to the Codex CLI models cache when no session is given", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-codex-"));
    const cachePath = path.join(dir, "models_cache.json");
    await fs.writeFile(
      cachePath,
      JSON.stringify({ models: [{ slug: "gpt-5.4", visibility: "list", priority: 16, supported_in_api: true }, { slug: "gpt-5.6-terra", visibility: "list", priority: 2, supported_in_api: true }] }),
    );
    vi.stubGlobal("fetch", vi.fn());

    const ids = await listModels("codex", { codexCachePath: cachePath });

    expect(ids).toEqual(["gpt-5.6-terra", "gpt-5.4"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("throws for providers without a model listing endpoint", async () => {
    await expect(listModels("unknown", {})).rejects.toThrow();
  });
});
