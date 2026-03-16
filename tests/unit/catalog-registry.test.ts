import { describe, it, expect, beforeEach } from "vitest";
import { CatalogRegistry } from "../../src/catalog/registry.js";
import type { BuildingBlock } from "../../src/catalog/types.js";

function makeBlock(overrides: Partial<BuildingBlock> = {}): BuildingBlock {
  return {
    id: "test-block",
    name: "Test Block",
    description: "A test building block",
    category: "git",
    event: "PreToolUse",
    canBlock: false,
    params: [],
    template: "echo hello",
    tags: ["test"],
    ...overrides,
  };
}

describe("CatalogRegistry", () => {
  let registry: CatalogRegistry;

  beforeEach(() => {
    registry = new CatalogRegistry();
  });

  it("registers and retrieves a block by id", () => {
    const block = makeBlock({ id: "my-block" });
    registry.register(block);
    expect(registry.get("my-block")).toEqual(block);
  });

  it("returns undefined for unknown block id", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("has() returns true for registered block", () => {
    registry.register(makeBlock({ id: "exists" }));
    expect(registry.has("exists")).toBe(true);
  });

  it("has() returns false for unknown block", () => {
    expect(registry.has("unknown")).toBe(false);
  });

  it("list() returns all registered blocks", () => {
    registry.register(makeBlock({ id: "block-a" }));
    registry.register(makeBlock({ id: "block-b" }));
    const all = registry.list();
    expect(all).toHaveLength(2);
    const ids = all.map((b) => b.id);
    expect(ids).toContain("block-a");
    expect(ids).toContain("block-b");
  });

  it("listByCategory() returns only blocks matching category", () => {
    registry.register(makeBlock({ id: "git-block", category: "git" }));
    registry.register(makeBlock({ id: "security-block", category: "security" }));
    const gitBlocks = registry.listByCategory("git");
    expect(gitBlocks).toHaveLength(1);
    expect(gitBlocks[0].id).toBe("git-block");
  });

  it("listByEvent() returns only blocks matching event", () => {
    registry.register(makeBlock({ id: "pre-block", event: "PreToolUse" }));
    registry.register(makeBlock({ id: "post-block", event: "PostToolUse" }));
    const preBlocks = registry.listByEvent("PreToolUse");
    expect(preBlocks).toHaveLength(1);
    expect(preBlocks[0].id).toBe("pre-block");
  });

  it("search() matches by name", () => {
    registry.register(makeBlock({ id: "git-commit-guard", name: "Git Commit Guard", tags: [] }));
    registry.register(makeBlock({ id: "file-blocker", name: "File Blocker", tags: [] }));
    const results = registry.search("commit");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("git-commit-guard");
  });

  it("search() matches by description", () => {
    registry.register(makeBlock({ id: "linter", description: "Runs eslint on files", tags: [] }));
    const results = registry.search("eslint");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("linter");
  });

  it("search() matches by tags", () => {
    registry.register(makeBlock({ id: "tagged-block", tags: ["security", "git"] }));
    registry.register(makeBlock({ id: "other-block", tags: ["notification"] }));
    const results = registry.search("security");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("tagged-block");
  });

  it("search() is case insensitive", () => {
    registry.register(makeBlock({ id: "my-block", name: "My Block", tags: [] }));
    const results = registry.search("MY BLOCK");
    expect(results).toHaveLength(1);
  });

  it("search() returns empty array when no match", () => {
    registry.register(makeBlock({ id: "unrelated", name: "Unrelated Block", tags: [] }));
    const results = registry.search("zzz-no-match");
    expect(results).toHaveLength(0);
  });
});
