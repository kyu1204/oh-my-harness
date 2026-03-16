import { describe, it, expect, beforeEach } from "vitest";
import { CatalogRegistry } from "../../src/catalog/registry.js";
import { convertHookEntries } from "../../src/catalog/converter.js";
import type { BuildingBlock, HookEntry } from "../../src/catalog/types.js";

function makeBlock(overrides: Partial<BuildingBlock> = {}): BuildingBlock {
  return {
    id: "test-block",
    name: "Test Block",
    description: "A test block",
    category: "git",
    event: "PreToolUse",
    matcher: "Bash",
    canBlock: false,
    params: [],
    template: "#!/bin/bash\necho done",
    tags: [],
    ...overrides,
  };
}

describe("convertHookEntries", () => {
  let registry: CatalogRegistry;
  const projectDir = "/tmp/test-project";

  beforeEach(() => {
    registry = new CatalogRegistry();
  });

  it("converts a hook entry to a settings hooks config", async () => {
    registry.register(
      makeBlock({ id: "my-block", event: "PreToolUse", matcher: "Bash", template: "#!/bin/bash\necho hi" }),
    );
    const entries: HookEntry[] = [{ block: "my-block", params: {} }];

    const result = await convertHookEntries(entries, registry, projectDir);

    expect(result.errors).toHaveLength(0);
    expect(result.hooksConfig).toBeDefined();
    expect(result.hooksConfig["PreToolUse"]).toBeDefined();
  });

  it("groups multiple entries by event", async () => {
    registry.register(makeBlock({ id: "pre-block-1", event: "PreToolUse", matcher: "Bash" }));
    registry.register(makeBlock({ id: "pre-block-2", event: "PreToolUse", matcher: "Edit" }));
    registry.register(makeBlock({ id: "post-block", event: "PostToolUse", matcher: "Bash" }));

    const entries: HookEntry[] = [
      { block: "pre-block-1", params: {} },
      { block: "pre-block-2", params: {} },
      { block: "post-block", params: {} },
    ];

    const result = await convertHookEntries(entries, registry, projectDir);

    expect(result.errors).toHaveLength(0);
    expect(result.hooksConfig["PreToolUse"]).toHaveLength(2);
    expect(result.hooksConfig["PostToolUse"]).toHaveLength(1);
  });

  it("reports error for unknown block id", async () => {
    const entries: HookEntry[] = [{ block: "does-not-exist", params: {} }];

    const result = await convertHookEntries(entries, registry, projectDir);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("does-not-exist");
  });

  it("reports error for missing required params", async () => {
    registry.register(
      makeBlock({
        id: "parameterized-block",
        params: [{ name: "cmd", type: "string", description: "command", required: true }],
        template: "#!/bin/bash\n{{cmd}}",
      }),
    );

    const entries: HookEntry[] = [{ block: "parameterized-block", params: {} }];

    const result = await convertHookEntries(entries, registry, projectDir);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("cmd");
  });

  it("renders template params into the script", async () => {
    registry.register(
      makeBlock({
        id: "echo-block",
        event: "PreToolUse",
        template: "#!/bin/bash\necho {{message}}",
        params: [{ name: "message", type: "string", description: "msg", required: true }],
      }),
    );

    const entries: HookEntry[] = [{ block: "echo-block", params: { message: "hello" } }];

    const result = await convertHookEntries(entries, registry, projectDir);

    expect(result.errors).toHaveLength(0);
    expect(result.scripts.size).toBeGreaterThan(0);
    const scriptContent = [...result.scripts.values()][0];
    expect(scriptContent).toContain("echo hello");
  });

  it("returns generated scripts map with script content", async () => {
    registry.register(makeBlock({ id: "simple-block", event: "SessionStart", template: "#!/bin/bash\necho start" }));
    const entries: HookEntry[] = [{ block: "simple-block", params: {} }];

    const result = await convertHookEntries(entries, registry, projectDir);

    expect(result.scripts).toBeInstanceOf(Map);
    expect(result.scripts.size).toBe(1);
  });

  it("handles empty entries list", async () => {
    const result = await convertHookEntries([], registry, projectDir);

    expect(result.errors).toHaveLength(0);
    expect(result.scripts.size).toBe(0);
    expect(Object.keys(result.hooksConfig)).toHaveLength(0);
  });

  it("continues processing valid entries when one entry is invalid", async () => {
    registry.register(makeBlock({ id: "valid-block", event: "PreToolUse" }));

    const entries: HookEntry[] = [
      { block: "invalid-block", params: {} },
      { block: "valid-block", params: {} },
    ];

    const result = await convertHookEntries(entries, registry, projectDir);

    expect(result.errors).toHaveLength(1);
    expect(result.hooksConfig["PreToolUse"]).toHaveLength(1);
  });
});
