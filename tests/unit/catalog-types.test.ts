import { describe, it, expect } from "vitest";
import type { HookEvent, BuildingBlockCategory } from "../../src/catalog/types.js";

describe("catalog types", () => {
  it("ConfigChange is a valid HookEvent", () => {
    const event: HookEvent = "ConfigChange";
    expect(event).toBe("ConfigChange");
  });

  it("audit is a valid BuildingBlockCategory", () => {
    const category: BuildingBlockCategory = "audit";
    expect(category).toBe("audit");
  });
});
