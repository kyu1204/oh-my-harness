import { describe, it, expect } from "vitest";

import { builtinBlocks } from "../../src/catalog/blocks/index.js";

describe("blocks index", () => {
  it("exports new blocks: sql-guard, desktop-notify, test-on-save, config-audit, compact-context", () => {
    const ids = builtinBlocks.map((b) => b.id);
    expect(ids).toContain("sql-guard");
    expect(ids).toContain("desktop-notify");
    expect(ids).toContain("test-on-save");
    expect(ids).toContain("config-audit");
    expect(ids).toContain("compact-context");
  });
});
