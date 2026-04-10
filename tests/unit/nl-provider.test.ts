import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  type LLMProvider,
  type ProviderDefinition,
  getAvailableProviders,
  getAvailableModels,
  createProvider,
} from "../../src/nl/provider-registry.js";
import type { ProviderConfig } from "../../src/nl/config-store.js";
import { createOpenaiApiProvider } from "../../src/nl/providers/openai-api.js";
import { createClaudeApiProvider } from "../../src/nl/providers/claude-api.js";
import { createGeminiApiProvider } from "../../src/nl/providers/gemini-api.js";

describe("provider-registry", () => {
  it("getAvailableProviders returns at least 3 providers", () => {
    const providers = getAvailableProviders();
    expect(providers.length).toBeGreaterThanOrEqual(3);
  });

  it("providers include claude, openai, gemini", () => {
    const providers = getAvailableProviders();
    const names = providers.map((p) => p.name);
    expect(names).toContain("claude");
    expect(names).toContain("openai");
    expect(names).toContain("gemini");
  });

  it("each provider has displayName, supportsCli, supportsApi", () => {
    const providers = getAvailableProviders();
    for (const p of providers) {
      expect(p.displayName).toBeTruthy();
      expect(typeof p.supportsCli).toBe("boolean");
      expect(typeof p.supportsApi).toBe("boolean");
    }
  });

  it("createProvider returns LLMProvider for CLI config", () => {
    const config: ProviderConfig = {
      provider: "claude",
      method: "cli",
      cliCommand: "claude",
    };
    const provider = createProvider(config);
    expect(provider).toBeDefined();
    expect(provider.name).toBe("claude");
    expect(typeof provider.run).toBe("function");
  });

  it("createProvider returns LLMProvider for API config", () => {
    const config: ProviderConfig = {
      provider: "openai",
      method: "api",
      apiKey: "sk-test",
      model: "gpt-4o",
    };
    const provider = createProvider(config);
    expect(provider).toBeDefined();
    expect(provider.name).toBe("openai");
    expect(typeof provider.run).toBe("function");
  });

  it("createProvider throws for unknown provider", () => {
    const config: ProviderConfig = {
      provider: "unknown-llm" as never,
      method: "api",
      apiKey: "key",
    };
    expect(() => createProvider(config)).toThrow();
  });

  it("claude provider supports both cli and api", () => {
    const providers = getAvailableProviders();
    const claude = providers.find((p) => p.name === "claude");
    expect(claude!.supportsCli).toBe(true);
    expect(claude!.supportsApi).toBe(true);
  });

  it("openai provider supports api only", () => {
    const providers = getAvailableProviders();
    const openai = providers.find((p) => p.name === "openai");
    expect(openai!.supportsCli).toBe(false);
    expect(openai!.supportsApi).toBe(true);
  });

  it("each provider has availableModels list with at least one model", () => {
    const providers = getAvailableProviders();
    for (const p of providers) {
      expect(p.availableModels.length).toBeGreaterThan(0);
    }
  });

  it("each model entry has id and label", () => {
    const providers = getAvailableProviders();
    for (const p of providers) {
      for (const m of p.availableModels) {
        expect(m.id).toBeTruthy();
        expect(m.label).toBeTruthy();
      }
    }
  });

  it("defaultModel is included in availableModels", () => {
    const providers = getAvailableProviders();
    for (const p of providers) {
      const ids = p.availableModels.map((m) => m.id);
      expect(ids).toContain(p.defaultModel);
    }
  });

  it("openai default model is gpt-5.4", () => {
    const providers = getAvailableProviders();
    const openai = providers.find((p) => p.name === "openai");
    expect(openai!.defaultModel).toBe("gpt-5.4");
  });

  it("claude default model is claude-sonnet-4-6", () => {
    const providers = getAvailableProviders();
    const claude = providers.find((p) => p.name === "claude");
    expect(claude!.defaultModel).toBe("claude-sonnet-4-6");
  });

  it("gemini default model is gemini-2.5-pro", () => {
    const providers = getAvailableProviders();
    const gemini = providers.find((p) => p.name === "gemini");
    expect(gemini!.defaultModel).toBe("gemini-2.5-pro");
  });

  it("getAvailableModels returns models for valid provider", () => {
    const models = getAvailableModels("openai");
    expect(models.length).toBeGreaterThan(0);
    expect(models[0].id).toBeTruthy();
  });

  it("getAvailableModels returns empty array for unknown provider", () => {
    const models = getAvailableModels("unknown-llm");
    expect(models).toEqual([]);
  });
});

describe("openai-api provider error handling", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries on 429 rate limit and succeeds on second attempt", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 429 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "hello" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const provider = createOpenaiApiProvider("sk-test");
    const result = await provider.run("test prompt");
    expect(result).toBe("hello");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 server error and succeeds on second attempt", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const provider = createOpenaiApiProvider("sk-test");
    const result = await provider.run("test prompt");
    expect(result).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws after 3 failed attempts on 429", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));

    const provider = createOpenaiApiProvider("sk-test");
    await expect(provider.run("test")).rejects.toThrow("429");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry on 401 unauthorized", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response("unauthorized", { status: 401 }));

    const provider = createOpenaiApiProvider("sk-test");
    await expect(provider.run("test")).rejects.toThrow("401");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws timeout error with clear message on AbortError", async () => {
    vi.stubGlobal("fetch", () => {
      const err = new DOMException("aborted", "AbortError");
      return Promise.reject(err);
    });

    const provider = createOpenaiApiProvider("sk-test");
    await expect(provider.run("test")).rejects.toThrow(
      "AI provider request timed out after 60 seconds",
    );
  });

  it("throws on empty string response from OpenAI", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = createOpenaiApiProvider("sk-test");
    await expect(provider.run("test")).rejects.toThrow(
      "Empty response from OpenAI",
    );
  });
});

describe("claude-api provider error handling", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries on 429 rate limit and succeeds on second attempt", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "hello from claude" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const provider = createClaudeApiProvider("sk-ant-test");
    const result = await provider.run("test prompt");
    expect(result).toBe("hello from claude");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws after 3 failed attempts on 500", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response("server error", { status: 500 }));

    const provider = createClaudeApiProvider("sk-ant-test");
    await expect(provider.run("test")).rejects.toThrow("500");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws timeout error with clear message on AbortError", async () => {
    vi.stubGlobal("fetch", () => {
      const err = new DOMException("aborted", "AbortError");
      return Promise.reject(err);
    });

    const provider = createClaudeApiProvider("sk-ant-test");
    await expect(provider.run("test")).rejects.toThrow(
      "AI provider request timed out after 60 seconds",
    );
  });
});

describe("gemini-api provider error handling", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries on 429 rate limit and succeeds on second attempt", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: "hello from gemini" }] } },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const provider = createGeminiApiProvider("gemini-key");
    const result = await provider.run("test prompt");
    expect(result).toBe("hello from gemini");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws after 3 failed attempts on 429", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));

    const provider = createGeminiApiProvider("gemini-key");
    await expect(provider.run("test")).rejects.toThrow("429");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws timeout error with clear message on AbortError", async () => {
    vi.stubGlobal("fetch", () => {
      const err = new DOMException("aborted", "AbortError");
      return Promise.reject(err);
    });

    const provider = createGeminiApiProvider("gemini-key");
    await expect(provider.run("test")).rejects.toThrow(
      "AI provider request timed out after 60 seconds",
    );
  });
});
