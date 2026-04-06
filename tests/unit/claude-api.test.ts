import { describe, it, expect } from "vitest";
import { createClaudeApiProvider } from "../../src/nl/providers/claude-api.js";

describe("claude-api provider", () => {
  it("creates a provider with name 'claude'", () => {
    const provider = createClaudeApiProvider("fake-key", "claude-sonnet-4-20250514");
    expect(provider.name).toBe("claude");
    expect(typeof provider.run).toBe("function");
  });
});
