import { describe, it, expect } from "vitest";

import { compactContext } from "../../src/catalog/blocks/compact-context.js";

describe("compactContext block", () => {
  it("has correct metadata", () => {
    expect(compactContext.id).toBe("compact-context");
    expect(compactContext.event).toBe("SessionStart");
    expect(compactContext.matcher).toBe("compact");
    expect(compactContext.canBlock).toBe(false);
  });

  it("has contextFile param with default", () => {
    const param = compactContext.params.find((p) => p.name === "contextFile");
    expect(param).toBeDefined();
    expect(param!.type).toBe("string");
    expect(param!.default).toBe("CLAUDE.md");
  });

  it("template uses triple-stash for contextFile", () => {
    expect(compactContext.template).toContain("{{{contextFile}}}");
  });

  it("does not contain _log_event wrapper", () => {
    expect(compactContext.template).not.toContain("_log_event");
  });
});
