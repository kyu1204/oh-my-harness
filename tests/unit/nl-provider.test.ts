import { describe, it, expect } from "vitest";
import {
  type LLMProvider,
  type ProviderDefinition,
  getAvailableProviders,
  createProvider,
} from "../../src/nl/provider-registry.js";
import type { ProviderConfig } from "../../src/nl/config-store.js";

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
});
