import { describe, it, expect } from "vitest";
import { createClaudeCliProvider } from "../../src/nl/providers/claude-cli.js";
import { createClaudeApiProvider } from "../../src/nl/providers/claude-api.js";
import { createOpenaiApiProvider } from "../../src/nl/providers/openai-api.js";
import { createGeminiApiProvider } from "../../src/nl/providers/gemini-api.js";

describe("claude-cli provider", () => {
  it("creates a provider with name 'claude'", () => {
    const provider = createClaudeCliProvider("claude");
    expect(provider.name).toBe("claude");
    expect(typeof provider.run).toBe("function");
  });

  it("rejects when CLI command not found", async () => {
    const provider = createClaudeCliProvider("nonexistent-cli-xyz");
    await expect(provider.run("test")).rejects.toThrow("not found");
  });
});

describe("claude-api provider", () => {
  it("creates a provider with name 'claude'", () => {
    const provider = createClaudeApiProvider("fake-key", "claude-sonnet-4-20250514");
    expect(provider.name).toBe("claude");
    expect(typeof provider.run).toBe("function");
  });
});

describe("openai-api provider", () => {
  it("creates a provider with name 'openai'", () => {
    const provider = createOpenaiApiProvider("fake-key", "gpt-4o");
    expect(provider.name).toBe("openai");
    expect(typeof provider.run).toBe("function");
  });
});

describe("gemini-api provider", () => {
  it("creates a provider with name 'gemini'", () => {
    const provider = createGeminiApiProvider("fake-key", "gemini-2.5-flash");
    expect(provider.name).toBe("gemini");
    expect(typeof provider.run).toBe("function");
  });
});
