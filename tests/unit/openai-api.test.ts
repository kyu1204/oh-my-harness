import { describe, it, expect } from "vitest";
import { createOpenaiApiProvider } from "../../src/nl/providers/openai-api.js";

describe("openai-api provider", () => {
  it("creates a provider with name 'openai'", () => {
    const provider = createOpenaiApiProvider("fake-key", "gpt-4o");
    expect(provider.name).toBe("openai");
    expect(typeof provider.run).toBe("function");
  });
});
