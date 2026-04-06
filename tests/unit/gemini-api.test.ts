import { describe, it, expect } from "vitest";
import { createGeminiApiProvider } from "../../src/nl/providers/gemini-api.js";

describe("gemini-api provider", () => {
  it("creates a provider with name 'gemini'", () => {
    const provider = createGeminiApiProvider("fake-key", "gemini-2.5-flash");
    expect(provider.name).toBe("gemini");
    expect(typeof provider.run).toBe("function");
  });
});
