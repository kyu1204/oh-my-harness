import { describe, it, expect } from "vitest";

import { builtinBlocks } from "../../src/catalog/blocks/index.js";

describe("blocks index", () => {
  it("exports new blocks: sql-guard, test-on-save", () => {
    const ids = builtinBlocks.map((b) => b.id);
    expect(ids).toContain("sql-guard");
    expect(ids).toContain("test-on-save");
    expect(ids).not.toContain("desktop-notify");
    expect(ids).not.toContain("config-audit");
    expect(ids).not.toContain("compact-context");
  });
});
