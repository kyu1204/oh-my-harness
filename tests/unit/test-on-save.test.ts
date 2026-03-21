import { describe, it, expect } from "vitest";

import { testOnSave } from "../../src/catalog/blocks/test-on-save.js";

describe("testOnSave block", () => {
  it("has correct metadata", () => {
    expect(testOnSave.id).toBe("test-on-save");
    expect(testOnSave.event).toBe("PostToolUse");
    expect(testOnSave.matcher).toBe("Edit|Write");
    expect(testOnSave.canBlock).toBe(false);
  });

  it("has testCommand param as required string", () => {
    const param = testOnSave.params.find((p) => p.name === "testCommand");
    expect(param).toBeDefined();
    expect(param!.type).toBe("string");
    expect(param!.required).toBe(true);
  });

  it("has filePattern param with default", () => {
    const param = testOnSave.params.find((p) => p.name === "filePattern");
    expect(param).toBeDefined();
    expect(param!.type).toBe("string");
    expect(param!.default).toBe("\\.(ts|tsx|js|jsx|py)$");
  });

  it("template uses triple-stash for params", () => {
    expect(testOnSave.template).toContain("{{{filePattern}}}");
    expect(testOnSave.template).toContain("{{{testCommand}}}");
  });

  it("does not contain _log_event wrapper", () => {
    expect(testOnSave.template).not.toContain("_log_event");
  });
});
