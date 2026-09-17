import { describe, it, expect } from "vitest";

import { builtinBlocks } from "../../src/catalog/blocks/index.js";

describe("blocks index", () => {
  it("exports all 21 catalog blocks", () => {
    const ids = builtinBlocks.map((b) => b.id);
    expect(ids).toContain("sql-guard");
    expect(ids).toContain("test-on-save");
    expect(ids).toContain("desktop-notify");
    expect(ids).toContain("config-audit");
    expect(ids).toContain("compact-context");
    expect(ids).toContain("worktree-setup");
    expect(ids).toContain("harness-guard");
    expect(ids).toContain("no-verify-guard");
    expect(ids).toContain("force-push-guard");
    expect(builtinBlocks.length).toBe(21);
  });
});
