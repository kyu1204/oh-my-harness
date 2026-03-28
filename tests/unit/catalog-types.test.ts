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

  it("WorktreeCreate is a valid HookEvent", () => {
    const event: HookEvent = "WorktreeCreate";
    expect(event).toBe("WorktreeCreate");
  });

  it("WorktreeRemove is a valid HookEvent", () => {
    const event: HookEvent = "WorktreeRemove";
    expect(event).toBe("WorktreeRemove");
  });
});
