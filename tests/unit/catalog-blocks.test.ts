import { describe, it, expect } from "vitest";
import { builtinBlocks } from "../../src/catalog/blocks/index.js";

describe("builtinBlocks", () => {
  it("exports exactly 10 blocks", () => {
    expect(builtinBlocks).toHaveLength(10);
  });

  it("all blocks have required fields (id, name, event, template)", () => {
    for (const block of builtinBlocks) {
      expect(block.id, `block missing id`).toBeTruthy();
      expect(block.name, `block ${block.id} missing name`).toBeTruthy();
      expect(block.event, `block ${block.id} missing event`).toBeTruthy();
      expect(block.template, `block ${block.id} missing template`).toBeTruthy();
    }
  });

  it("no duplicate IDs", () => {
    const ids = builtinBlocks.map((b) => b.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("all templates contain INPUT=$(cat)", () => {
    for (const block of builtinBlocks) {
      expect(block.template, `block ${block.id} template missing INPUT=$(cat)`).toContain(
        "INPUT=$(cat)"
      );
    }
  });

  it("PreToolUse blocks with canBlock=true have decision/block in template", () => {
    const blocking = builtinBlocks.filter(
      (b) => b.event === "PreToolUse" && b.canBlock === true
    );
    for (const block of blocking) {
      expect(
        block.template,
        `block ${block.id} should have decision block output`
      ).toMatch(/decision.*block|block.*decision/);
    }
  });

  it("all blocks have at least one tag", () => {
    for (const block of builtinBlocks) {
      expect(block.tags, `block ${block.id} has no tags`).toBeDefined();
      expect(block.tags.length, `block ${block.id} must have at least one tag`).toBeGreaterThan(0);
    }
  });

  it("all blocks have a valid category", () => {
    for (const block of builtinBlocks) {
      expect(block.category, `block ${block.id} missing category`).toBeTruthy();
    }
  });

  it("canBlock is boolean for all blocks", () => {
    for (const block of builtinBlocks) {
      expect(typeof block.canBlock, `block ${block.id} canBlock must be boolean`).toBe("boolean");
    }
  });

  it("PostToolUse blocks have canBlock=false", () => {
    const postBlocks = builtinBlocks.filter((b) => b.event === "PostToolUse");
    for (const block of postBlocks) {
      expect(block.canBlock, `PostToolUse block ${block.id} should have canBlock=false`).toBe(
        false
      );
    }
  });
});
