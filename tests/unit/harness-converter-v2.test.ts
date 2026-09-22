import { describe, it, expect } from "vitest";
import { harnessToMergedConfigV2, effectiveHookEntries } from "../../src/core/harness-converter-v2.js";
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

describe("effectiveHookEntries (QA: omh test / omh stats must see always-on guards)", () => {
  it("adds harness-guard, no-verify-guard and force-push-guard to any harness that has a hook", async () => {
    const { HarnessConfigSchema } = await import("../../src/core/harness-schema.js");
    const registry = await createDefaultRegistry();
    const h = HarnessConfigSchema.parse({ version: "1.0", loop: { enabled: false }, hooks: [{ block: "path-guard", params: { blockedPaths: ["dist/"] } }] });
    const ids = effectiveHookEntries(h, registry).map((e) => e.block);
    expect(ids).toEqual(["path-guard", "harness-guard", "no-verify-guard", "force-push-guard"]);
  });

  it("is empty for a harness with no hooks, and keeps an explicit entry's mode", async () => {
    const { HarnessConfigSchema } = await import("../../src/core/harness-schema.js");
    const registry = await createDefaultRegistry();
    expect(effectiveHookEntries(HarnessConfigSchema.parse({ version: "1.0", loop: { enabled: false } }), registry)).toEqual([]);
    const h = HarnessConfigSchema.parse({ version: "1.0", loop: { enabled: false }, hooks: [{ block: "force-push-guard", params: {}, mode: "ask" }] });
    const entries = effectiveHookEntries(h, registry);
    expect(entries.filter((e) => e.block === "force-push-guard")).toHaveLength(1);
    expect(entries.find((e) => e.block === "force-push-guard")!.mode).toBe("ask");
  });
});

describe("effectiveHookEntries mirrors the loop-guard rule (review)", () => {
  it("adds loop-guard with the loop's paths, then the always-on guards, when the loop is enabled", async () => {
    const { HarnessConfigSchema } = await import("../../src/core/harness-schema.js");
    const registry = await createDefaultRegistry();
    const h = HarnessConfigSchema.parse({ version: "1.0", loop: { enabled: true, workOrders: "orders" } });
    const entries = effectiveHookEntries(h, registry);
    expect(entries.map((e) => e.block)).toEqual(["loop-guard", "harness-guard", "no-verify-guard", "force-push-guard"]);
    expect(entries[0].params).toMatchObject({ workOrders: "orders" });
  });
});

describe("Stop event routing (#117)", () => {
  it("routes a Stop block to hooks.stop and the generator emits a matcher-less Stop hook", async () => {
    const { HarnessConfigSchema } = await import("../../src/core/harness-schema.js");
    const { computeHooks } = await import("../../src/generators/hooks.js");
    const registry = await createDefaultRegistry();
    const h = HarnessConfigSchema.parse({ version: "1.0", loop: { enabled: false }, hooks: [{ block: "stop-test-gate", params: { testCommand: "npm test" } }, { block: "stop-uncommitted-warn", params: {} }] });
    const merged = await harnessToMergedConfigV2(h, registry);
    expect(merged.hooks.stop?.map((x) => x.id)).toEqual(["catalog-stop-test-gate", "catalog-stop-uncommitted-warn"]);
    const fs = await import("node:fs/promises"); const os = await import("node:os"); const path = await import("node:path");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-stop-route-"));
    try {
      const plan = await computeHooks({ projectDir: dir, config: merged });
      expect(plan.hooksConfig["Stop"]).toHaveLength(2);
      expect(plan.hooksConfig["Stop"][0]).not.toHaveProperty("matcher");   // Stop has no matcher support
      expect(plan.hooksConfig["Stop"][0].hooks[0].command).toMatch(/catalog-stop-test-gate\.sh/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("rule-derived guards (#144, #145)", () => {
  it("adds semantic-rule-guard from rules marked enforce: true and semantic-diff-gate from rules with lint:", async () => {
    const { HarnessConfigSchema } = await import("../../src/core/harness-schema.js");
    const registry = await createDefaultRegistry();
    const h = HarnessConfigSchema.parse({
      version: "1.0", loop: { enabled: false },
      rules: [
        { id: "deps", title: "No new deps", content: "Do not add npm dependencies without asking", enforce: true },
        { id: "style", title: "Style", content: "Prefer named exports" },
        { id: "secrets", title: "Secrets", content: "Never commit secrets", lint: "hardcodes a secret, token or password" },
      ],
      hooks: [{ block: "branch-guard", params: {} }],
    });
    const entries = effectiveHookEntries(h, registry);
    const srg = entries.find((e) => e.block === "semantic-rule-guard")!;
    expect(srg.params.rules).toEqual(["No new deps: Do not add npm dependencies without asking"]);
    const sdg = entries.find((e) => e.block === "semantic-diff-gate")!;
    expect(sdg.params.rules).toEqual(["hardcodes a secret, token or password"]);
    const merged = await harnessToMergedConfigV2(h, registry);
    expect(merged.hooks.preToolUse.map((x) => x.id)).toEqual(expect.arrayContaining(["catalog-semantic-rule-guard", "catalog-semantic-diff-gate"]));
  });

  it("merges enforce/lint rules into an explicit entry's rules instead of dropping them (QA: strict preset writes the gate explicitly)", async () => {
    const { HarnessConfigSchema } = await import("../../src/core/harness-schema.js");
    const registry = await createDefaultRegistry();
    const h = HarnessConfigSchema.parse({
      version: "1.0", loop: { enabled: false },
      rules: [
        { id: "a", title: "No deps", content: "no new deps", enforce: true },
        { id: "b", title: "B", content: "x", lint: "logs a secret" },
        { id: "c", title: "C", content: "x", lint: "preset lint" },
      ],
      hooks: [
        { block: "semantic-diff-gate", params: { rules: ["preset lint"], threshold: 0.9 }, mode: "block" },
        { block: "semantic-rule-guard", params: { rules: ["custom"], blockAbove: 0.95 }, mode: "ask" },
      ],
    });
    const entries = effectiveHookEntries(h, registry);
    const sdg = entries.filter((e) => e.block === "semantic-diff-gate");
    expect(sdg).toHaveLength(1);
    expect(sdg[0].params).toMatchObject({ rules: ["preset lint", "logs a secret"], threshold: 0.9 });
    const srg = entries.filter((e) => e.block === "semantic-rule-guard");
    expect(srg).toHaveLength(1);
    expect(srg[0].params).toMatchObject({ rules: ["custom", "No deps: no new deps"], blockAbove: 0.95 });
    expect(srg[0].mode).toBe("ask");
  });

  it("adds neither without such rules, and an explicit entry keeps its own params", async () => {
    const { HarnessConfigSchema } = await import("../../src/core/harness-schema.js");
    const registry = await createDefaultRegistry();
    const plain = HarnessConfigSchema.parse({ version: "1.0", loop: { enabled: false }, rules: [{ id: "a", title: "A", content: "x" }], hooks: [{ block: "branch-guard", params: {} }] });
    expect(effectiveHookEntries(plain, registry).map((e) => e.block)).not.toEqual(expect.arrayContaining(["semantic-rule-guard", "semantic-diff-gate"]));
    const explicit = HarnessConfigSchema.parse({
      version: "1.0", loop: { enabled: false },
      rules: [{ id: "a", title: "A", content: "no deps", enforce: true }],
      hooks: [{ block: "semantic-rule-guard", params: { rules: ["custom"], blockAbove: 0.95 }, mode: "ask" }],
    });
    const e = effectiveHookEntries(explicit, registry).filter((x) => x.block === "semantic-rule-guard");
    expect(e).toHaveLength(1);
    expect(e[0].params).toMatchObject({ rules: ["custom", "A: no deps"], blockAbove: 0.95 });
    expect(e[0].mode).toBe("ask");
  });
});
