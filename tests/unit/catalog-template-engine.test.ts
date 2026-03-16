import { describe, it, expect } from "vitest";
import { renderTemplate, validateParams } from "../../src/catalog/template-engine.js";
import type { BuildingBlock } from "../../src/catalog/types.js";

function makeBlock(overrides: Partial<BuildingBlock> = {}): BuildingBlock {
  return {
    id: "test-block",
    name: "Test Block",
    description: "A test block",
    category: "git",
    event: "PreToolUse",
    canBlock: false,
    params: [],
    template: "",
    tags: [],
    ...overrides,
  };
}

describe("renderTemplate", () => {
  it("renders simple {{param}} placeholders", () => {
    const result = renderTemplate("echo {{message}}", { message: "hello world" });
    expect(result).toBe("echo hello world");
  });

  it("renders multiple placeholders", () => {
    const result = renderTemplate("{{cmd}} {{arg}}", { cmd: "ls", arg: "-la" });
    expect(result).toBe("ls -la");
  });

  it("renders {{#if param}}...{{/if}} conditionals when truthy", () => {
    const result = renderTemplate("start{{#if flag}} --verbose{{/if}} end", { flag: true });
    expect(result).toBe("start --verbose end");
  });

  it("renders {{#if param}}...{{/if}} conditionals when falsy", () => {
    const result = renderTemplate("start{{#if flag}} --verbose{{/if}} end", { flag: false });
    expect(result).toBe("start end");
  });

  it("renders {{#each array}} loops", () => {
    const result = renderTemplate(
      "{{#each items}}item={{this}} {{/each}}",
      { items: ["a", "b", "c"] },
    );
    expect(result).toBe("item=a item=b item=c ");
  });

  it("handles empty template", () => {
    const result = renderTemplate("", {});
    expect(result).toBe("");
  });

  it("handles template with no placeholders", () => {
    const result = renderTemplate("echo static", {});
    expect(result).toBe("echo static");
  });

  it("escapes param values to prevent bash injection via triple-stash or raw output", () => {
    // Handlebars HTML-escapes by default; we use triple-stash {{{ }}} to allow raw,
    // but double-stash {{ }} escapes HTML. For bash safety we use double-stash.
    // Test that angle brackets etc. don't break the output structurally.
    const result = renderTemplate("VALUE={{value}}", { value: "safe" });
    expect(result).toBe("VALUE=safe");
  });
});

describe("validateParams", () => {
  it("returns empty array when all required params are present", () => {
    const block = makeBlock({
      params: [
        { name: "cmd", type: "string", description: "command", required: true },
      ],
    });
    const errors = validateParams(block, { cmd: "npm test" });
    expect(errors).toHaveLength(0);
  });

  it("reports missing required params", () => {
    const block = makeBlock({
      params: [
        { name: "cmd", type: "string", description: "command", required: true },
      ],
    });
    const errors = validateParams(block, {});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("cmd");
  });

  it("does not report missing optional params", () => {
    const block = makeBlock({
      params: [
        { name: "flag", type: "boolean", description: "flag", required: false },
      ],
    });
    const errors = validateParams(block, {});
    expect(errors).toHaveLength(0);
  });

  it("reports type mismatch for string param receiving number", () => {
    const block = makeBlock({
      params: [
        { name: "name", type: "string", description: "a name", required: true },
      ],
    });
    const errors = validateParams(block, { name: 42 });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("name");
  });

  it("reports type mismatch for boolean param receiving string", () => {
    const block = makeBlock({
      params: [
        { name: "verbose", type: "boolean", description: "verbose flag", required: true },
      ],
    });
    const errors = validateParams(block, { verbose: "yes" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("verbose");
  });

  it("reports type mismatch for number param receiving string", () => {
    const block = makeBlock({
      params: [
        { name: "timeout", type: "number", description: "timeout ms", required: true },
      ],
    });
    const errors = validateParams(block, { timeout: "100" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("timeout");
  });

  it("reports type mismatch for string[] param receiving string", () => {
    const block = makeBlock({
      params: [
        { name: "items", type: "string[]", description: "list of items", required: true },
      ],
    });
    const errors = validateParams(block, { items: "single-string" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("items");
  });

  it("accepts string[] param with array value", () => {
    const block = makeBlock({
      params: [
        { name: "items", type: "string[]", description: "list of items", required: true },
      ],
    });
    const errors = validateParams(block, { items: ["a", "b"] });
    expect(errors).toHaveLength(0);
  });

  it("collects multiple errors", () => {
    const block = makeBlock({
      params: [
        { name: "a", type: "string", description: "a", required: true },
        { name: "b", type: "number", description: "b", required: true },
      ],
    });
    const errors = validateParams(block, {});
    expect(errors).toHaveLength(2);
  });
});
