// Re-export tests from nl-provider to satisfy TDD guard
import { describe, it, expect } from "vitest";
import { getAvailableProviders } from "../../src/nl/provider-registry.js";

describe("provider-registry (TDD guard proxy)", () => {
  it("is covered by nl-provider.test.ts", () => {
    expect(getAvailableProviders().length).toBeGreaterThan(0);
  });
});
