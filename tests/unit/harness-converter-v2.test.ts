import { describe, it, expect } from "vitest";
import { harnessToMergedConfigV2 } from "../../src/core/harness-converter-v2.js";
import { CatalogRegistry } from "../../src/catalog/registry.js";
import { createDefaultRegistry } from "../../src/catalog/registry.js";
import type { HarnessConfig } from "../../src/core/harness-schema.js";
import type { BuildingBlock } from "../../src/catalog/types.js";

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

const baseHarness: HarnessConfig = {
  version: "1.0",
  project: {
    name: "test-app",
    description: "A test app",
    stacks: [
      {
        name: "frontend",
        framework: "nextjs",
        language: "typescript",
        packageManager: "pnpm",
        testRunner: "vitest",
        linter: "eslint",
      },
    ],
  },
  rules: [
    {
      id: "rule-1",
      title: "App Router",
      content: "## App Router\n\n- Use App Router always",
      priority: 20,
    },
  ],
  enforcement: {
    preCommit: [],
    blockedPaths: [],
    blockedCommands: [],
    postSave: [],
  },
  permissions: {
    allow: ["Bash(pnpm test*)"],
    deny: [],
  },
  hooks: [],
};

describe("harnessToMergedConfigV2", () => {
  it("converts enforcement-only config via catalog pipeline (backward compat)", async () => {
    const registry = await createDefaultRegistry();
    const harness: HarnessConfig = {
      ...baseHarness,
      enforcement: {
        preCommit: ["npm test"],
        blockedPaths: [],
        blockedCommands: [],
        postSave: [],
      },
    };
    const result = await harnessToMergedConfigV2(harness, registry);

    expect(result.presets).toEqual(["harness"]);
    expect(result.claudeMdSections).toHaveLength(1);
    expect(result.hooks).toBeDefined();
    // enforcement.preCommit → commit-test-gate catalog hook
    const catalogHook = result.hooks.preToolUse.find((h) => h.id === "catalog-commit-test-gate");
    expect(catalogHook).toBeDefined();
  });

  it("converts v2 hooks-only config", async () => {
    const registry = new CatalogRegistry();
    registry.register(
      makeBlock({
        id: "my-block",
        event: "PreToolUse",
        matcher: "Bash",
        template: "#!/bin/bash\necho hi",
      }),
    );

    const hooksOnly: HarnessConfig = {
      version: "1.0",
      project: { stacks: [{ name: "app", framework: "express", language: "javascript" }] },
      rules: [],
      enforcement: { preCommit: [], blockedPaths: [], blockedCommands: [], postSave: [] },
      permissions: { allow: [], deny: [] },
      hooks: [{ block: "my-block", params: {} }],
    };

    const result = await harnessToMergedConfigV2(hooksOnly, registry);

    expect(result.catalogErrors).toBeUndefined();
    // catalog hook should produce a preToolUse hook
    const catalogHook = result.hooks.preToolUse.find((h) => h.id === "catalog-my-block");
    expect(catalogHook).toBeDefined();
    expect(catalogHook!.matcher).toBe("Bash");
  });

  it("converts mixed enforcement+hooks config via catalog pipeline", async () => {
    const registry = await createDefaultRegistry();

    const mixed: HarnessConfig = {
      ...baseHarness,
      enforcement: {
        preCommit: ["npm test"],
        blockedPaths: [],
        blockedCommands: [],
        postSave: [],
      },
      hooks: [{ block: "branch-guard", params: {} }],
    };

    const result = await harnessToMergedConfigV2(mixed, registry);

    // enforcement.preCommit → commit-test-gate catalog hook
    const testGate = result.hooks.preToolUse.find((h) => h.id === "catalog-commit-test-gate");
    expect(testGate).toBeDefined();

    // explicit hooks → branch-guard catalog hook
    const branchGuard = result.hooks.preToolUse.find((h) => h.id === "catalog-branch-guard");
    expect(branchGuard).toBeDefined();
  });

  it("returns catalogErrors when unknown block id is used", async () => {
    const registry = new CatalogRegistry();

    const config: HarnessConfig = {
      ...baseHarness,
      hooks: [{ block: "does-not-exist", params: {} }],
    };

    const result = await harnessToMergedConfigV2(config, registry);

    expect(result.catalogErrors).toBeDefined();
    expect(result.catalogErrors!.length).toBeGreaterThan(0);
    expect(result.catalogErrors![0]).toContain("does-not-exist");
  });

  it("returns catalogErrors when missing required params", async () => {
    const registry = new CatalogRegistry();
    registry.register(
      makeBlock({
        id: "parameterized-block",
        params: [{ name: "cmd", type: "string", description: "command", required: true }],
        template: "#!/bin/bash\n{{cmd}}",
      }),
    );

    const config: HarnessConfig = {
      ...baseHarness,
      hooks: [{ block: "parameterized-block", params: {} }],
    };

    const result = await harnessToMergedConfigV2(config, registry);

    expect(result.catalogErrors).toBeDefined();
    expect(result.catalogErrors!.length).toBeGreaterThan(0);
    expect(result.catalogErrors![0]).toContain("cmd");
  });

  it("explicit hooks take priority over enforcement for same block", async () => {
    const registry = await createDefaultRegistry();

    const config: HarnessConfig = {
      ...baseHarness,
      enforcement: {
        preCommit: [],
        blockedPaths: [".next/"],
        blockedCommands: [],
        postSave: [],
      },
      hooks: [{ block: "path-guard", params: { blockedPaths: ["dist/", "build/"] } }],
    };

    const result = await harnessToMergedConfigV2(config, registry);

    // Only one path-guard (explicit), not two
    const pathGuards = result.hooks.preToolUse.filter((h) => h.id === "catalog-path-guard");
    expect(pathGuards).toHaveLength(1);
  });

  it("keeps valid hooks when some blocks are invalid", async () => {
    const registry = await createDefaultRegistry();
    const config: HarnessConfig = {
      ...baseHarness,
      hooks: [
        { block: "branch-guard", params: {} },
        { block: "nonexistent-block", params: {} },
        { block: "command-guard", params: { patterns: ["rm -rf /"] } },
      ],
    };
    const result = await harnessToMergedConfigV2(config, registry);
    // Valid hooks should be present
    expect(result.hooks.preToolUse.length).toBeGreaterThanOrEqual(2);
    expect(result.hooks.preToolUse.some(h => h.id.includes("branch-guard"))).toBe(true);
    expect(result.hooks.preToolUse.some(h => h.id.includes("command-guard"))).toBe(true);
    // Errors should be reported but not block valid hooks
    expect(result.catalogErrors).toBeDefined();
    expect(result.catalogErrors!.some(e => e.includes("nonexistent-block"))).toBe(true);
  });

  it("empty hooks array with empty enforcement produces no catalog errors", async () => {
    const registry = new CatalogRegistry();

    const config: HarnessConfig = {
      ...baseHarness,
      hooks: [],
    };

    const result = await harnessToMergedConfigV2(config, registry);

    expect(result.catalogErrors).toBeUndefined();
  });

  it("routes SessionStart events to sessionStart hooks", async () => {
    const registry = new CatalogRegistry();
    registry.register(
      makeBlock({
        id: "compact-context",
        event: "SessionStart",
        matcher: "compact",
        category: "automation",
        template: "#!/bin/bash\necho context",
      }),
    );

    const config: HarnessConfig = {
      ...baseHarness,
      hooks: [{ block: "compact-context", params: {} }],
    };

    const result = await harnessToMergedConfigV2(config, registry);

    expect(result.catalogErrors).toBeUndefined();
    const hook = result.hooks.sessionStart?.find((h) => h.id === "catalog-compact-context");
    expect(hook).toBeDefined();
    expect(hook!.matcher).toBe("compact");
  });

  it("routes Notification events to notification hooks", async () => {
    const registry = new CatalogRegistry();
    registry.register(
      makeBlock({
        id: "desktop-notify",
        event: "Notification",
        matcher: "",
        category: "notification",
        template: "#!/bin/bash\necho notify",
      }),
    );

    const config: HarnessConfig = {
      ...baseHarness,
      hooks: [{ block: "desktop-notify", params: {} }],
    };

    const result = await harnessToMergedConfigV2(config, registry);

    expect(result.catalogErrors).toBeUndefined();
    const hook = result.hooks.notification?.find((h) => h.id === "catalog-desktop-notify");
    expect(hook).toBeDefined();
  });

  it("routes ConfigChange events to configChange hooks", async () => {
    const registry = new CatalogRegistry();
    registry.register(
      makeBlock({
        id: "config-audit",
        event: "ConfigChange",
        matcher: "",
        category: "audit",
        template: "#!/bin/bash\necho audit",
      }),
    );

    const config: HarnessConfig = {
      ...baseHarness,
      hooks: [{ block: "config-audit", params: {} }],
    };

    const result = await harnessToMergedConfigV2(config, registry);

    expect(result.catalogErrors).toBeUndefined();
    const hook = result.hooks.configChange?.find((h) => h.id === "catalog-config-audit");
    expect(hook).toBeDefined();
  });

  it("allows duplicate block ids with different params (multi-instance)", async () => {
    const registry = new CatalogRegistry();
    registry.register(
      makeBlock({
        id: "lint-on-save",
        event: "PostToolUse",
        matcher: "Edit|Write",
        template: "#!/bin/bash\necho {{{command}}}",
        params: [
          { name: "filePattern", type: "string", description: "glob", required: true },
          { name: "command", type: "string", description: "cmd", required: true },
        ],
      }),
    );

    const config: HarnessConfig = {
      ...baseHarness,
      hooks: [
        { block: "lint-on-save", params: { filePattern: "*.ts", command: "eslint" } },
        { block: "lint-on-save", params: { filePattern: "*.py", command: "ruff" } },
      ],
    };

    const result = await harnessToMergedConfigV2(config, registry);

    // Both instances should exist, not just the first
    const lintHooks = result.hooks.postToolUse.filter((h) => h.id.includes("lint-on-save"));
    expect(lintHooks.length).toBe(2);
    // Verify different params rendered into different scripts
    expect(lintHooks[0].inline).toContain("eslint");
    expect(lintHooks[1].inline).toContain("ruff");
    // Verify distinct IDs
    expect(lintHooks[0].id).not.toBe(lintHooks[1].id);
    // No duplicate error
    expect(result.catalogErrors?.some((e) => e.includes("Duplicate"))).toBeFalsy();
  });
});
