import { describe, it, expect } from "vitest";
import { worktreeSetup } from "../../src/catalog/blocks/worktree-setup.js";

describe("worktree-setup block", () => {
  it("has correct id", () => {
    expect(worktreeSetup.id).toBe("worktree-setup");
  });

  it("has event WorktreeCreate", () => {
    expect(worktreeSetup.event).toBe("WorktreeCreate");
  });

  it("has category automation", () => {
    expect(worktreeSetup.category).toBe("automation");
  });

  it("does not block (canBlock = false)", () => {
    expect(worktreeSetup.canBlock).toBe(false);
  });

  it("has symlinkPaths and copyPaths params", () => {
    const paramNames = worktreeSetup.params.map((p) => p.name);
    expect(paramNames).toContain("symlinkPaths");
    expect(paramNames).toContain("copyPaths");
  });

  it("has a template that creates symlinks and copies", () => {
    expect(worktreeSetup.template).toContain("ln -s");
    expect(worktreeSetup.template).toContain("cp");
  });

  it("has installCommand param", () => {
    const paramNames = worktreeSetup.params.map((p) => p.name);
    expect(paramNames).toContain("installCommand");
  });

  it("uses array defaults for symlinkPaths and copyPaths", () => {
    const symlinkParam = worktreeSetup.params.find((p) => p.name === "symlinkPaths");
    const copyParam = worktreeSetup.params.find((p) => p.name === "copyPaths");
    expect(Array.isArray(symlinkParam!.default)).toBe(true);
    expect(Array.isArray(copyParam!.default)).toBe(true);
  });

  it("template uses Handlebars each for array iteration", () => {
    expect(worktreeSetup.template).toContain("{{#each symlinkPaths}}");
    expect(worktreeSetup.template).toContain("{{#each copyPaths}}");
  });
});
