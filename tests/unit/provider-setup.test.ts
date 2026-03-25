import { describe, it, expect } from "vitest";
import { getAvailableProviders } from "../../src/nl/provider-registry.js";

describe("provider-setup TUI data", () => {
  it("provider list has display names for TUI selection", () => {
    const providers = getAvailableProviders();
    for (const p of providers) {
      expect(p.displayName.length).toBeGreaterThan(0);
    }
  });

  it("claude is the only provider with CLI support", () => {
    const providers = getAvailableProviders();
    const cliProviders = providers.filter((p) => p.supportsCli);
    expect(cliProviders).toHaveLength(1);
    expect(cliProviders[0].name).toBe("claude");
  });

  it("all providers have a default model", () => {
    const providers = getAvailableProviders();
    for (const p of providers) {
      expect(p.defaultModel.length).toBeGreaterThan(0);
    }
  });
});
