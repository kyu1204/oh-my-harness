import { describe, it, expect } from "vitest";
import { createClaudeCliProvider } from "../../src/nl/providers/claude-cli.js";

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
