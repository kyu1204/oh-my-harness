import { describe, it, expect } from "vitest";
import { harnessToMergedConfig, convertEnforcementToHooks, mergeEnforcementAndHooks } from "../../src/core/harness-converter.js";
import type { HarnessConfig } from "../../src/core/harness-schema.js";

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
    {
      id: "rule-2",
      title: "Testing",
      content: "## Testing\n\n- Write tests first",
      priority: 30,
    },
  ],
  enforcement: {
    preCommit: ["test", "lint"],
    blockedPaths: [".next/", "node_modules/"],
    blockedCommands: ["rm -rf /", "sudo rm"],
    postSave: [
      { pattern: "*.ts", command: "eslint --fix" },
    ],
  },
  hooks: [],
  permissions: {
    allow: ["Bash(pnpm test*)"],
    deny: ["Bash(rm -rf /)"],
  },
};

describe("convertEnforcementToHooks", () => {
  it("converts preCommit commands to commit-test-gate hooks", () => {
    const hooks = convertEnforcementToHooks({
      preCommit: ["npm test", "vitest run"],
      blockedPaths: [],
      blockedCommands: [],
      postSave: [],
    });
    const testGates = hooks.filter((h) => h.block === "commit-test-gate");
    expect(testGates).toHaveLength(2);
    expect(testGates[0].params).toEqual({ testCommand: "npm test" });
    expect(testGates[1].params).toEqual({ testCommand: "vitest run" });
  });

  it("converts tsc-containing preCommit to commit-typecheck-gate", () => {
    const hooks = convertEnforcementToHooks({
      preCommit: ["npx tsc --noEmit"],
      blockedPaths: [],
      blockedCommands: [],
      postSave: [],
    });
    expect(hooks).toHaveLength(1);
    expect(hooks[0].block).toBe("commit-typecheck-gate");
    expect(hooks[0].params).toEqual({ typecheckCommand: "npx tsc --noEmit" });
  });

  it("converts blockedPaths to path-guard hook", () => {
    const hooks = convertEnforcementToHooks({
      preCommit: [],
      blockedPaths: [".next/", "node_modules/"],
      blockedCommands: [],
      postSave: [],
    });
    expect(hooks).toHaveLength(1);
    expect(hooks[0].block).toBe("path-guard");
    expect(hooks[0].params).toEqual({ blockedPaths: [".next/", "node_modules/"] });
  });

  it("converts blockedCommands to command-guard hook", () => {
    const hooks = convertEnforcementToHooks({
      preCommit: [],
      blockedPaths: [],
      blockedCommands: ["rm -rf /", "sudo rm"],
      postSave: [],
    });
    expect(hooks).toHaveLength(1);
    expect(hooks[0].block).toBe("command-guard");
    expect(hooks[0].params).toEqual({ patterns: ["rm -rf /", "sudo rm"] });
  });

  it("converts postSave to lint-on-save hooks", () => {
    const hooks = convertEnforcementToHooks({
      preCommit: [],
      blockedPaths: [],
      blockedCommands: [],
      postSave: [
        { pattern: "*.ts", command: "eslint --fix" },
        { pattern: "*.py", command: "ruff check --fix" },
      ],
    });
    const lintHooks = hooks.filter((h) => h.block === "lint-on-save");
    expect(lintHooks).toHaveLength(2);
    expect(lintHooks[0].params).toEqual({ filePattern: "*.ts", command: "eslint --fix" });
    expect(lintHooks[1].params).toEqual({ filePattern: "*.py", command: "ruff check --fix" });
  });

  it("returns empty array for empty enforcement", () => {
    const hooks = convertEnforcementToHooks({
      preCommit: [],
      blockedPaths: [],
      blockedCommands: [],
      postSave: [],
    });
    expect(hooks).toEqual([]);
  });

  it("handles mixed preCommit with both test and typecheck commands", () => {
    const hooks = convertEnforcementToHooks({
      preCommit: ["npm test", "npx tsc --noEmit", "vitest run"],
      blockedPaths: [],
      blockedCommands: [],
      postSave: [],
    });
    expect(hooks).toHaveLength(3);
    expect(hooks[0].block).toBe("commit-test-gate");
    expect(hooks[1].block).toBe("commit-typecheck-gate");
    expect(hooks[2].block).toBe("commit-test-gate");
  });
});

describe("mergeEnforcementAndHooks", () => {
  it("returns only enforcement-derived hooks when no explicit hooks", () => {
    const harness: HarnessConfig = {
      ...baseHarness,
      enforcement: {
        preCommit: [],
        blockedPaths: [".next/"],
        blockedCommands: [],
        postSave: [],
      },
      hooks: [],
    };
    const merged = mergeEnforcementAndHooks(harness);
    expect(merged).toHaveLength(1);
    expect(merged[0].block).toBe("path-guard");
  });

  it("explicit hooks take priority over enforcement-derived hooks for same block", () => {
    const harness: HarnessConfig = {
      ...baseHarness,
      enforcement: {
        preCommit: [],
        blockedPaths: [".next/"],
        blockedCommands: [],
        postSave: [],
      },
      hooks: [
        { block: "path-guard", params: { blockedPaths: ["dist/", "build/"] } },
      ],
    };
    const merged = mergeEnforcementAndHooks(harness);
    // Should only have the explicit one, not the enforcement-derived one
    const pathGuards = merged.filter((h) => h.block === "path-guard");
    expect(pathGuards).toHaveLength(1);
    expect(pathGuards[0].params).toEqual({ blockedPaths: ["dist/", "build/"] });
  });

  it("includes both enforcement and explicit hooks when no overlap", () => {
    const harness: HarnessConfig = {
      ...baseHarness,
      enforcement: {
        preCommit: [],
        blockedPaths: [".next/"],
        blockedCommands: [],
        postSave: [],
      },
      hooks: [
        { block: "branch-guard", params: {} },
      ],
    };
    const merged = mergeEnforcementAndHooks(harness);
    expect(merged).toHaveLength(2);
    expect(merged.map((h) => h.block)).toContain("path-guard");
    expect(merged.map((h) => h.block)).toContain("branch-guard");
  });
});

describe("harnessToMergedConfig", () => {
  it("converts basic harness config to MergedConfig", () => {
    const merged = harnessToMergedConfig(baseHarness);
    expect(merged.presets).toEqual(["harness"]);
    expect(merged.variables).toBeDefined();
    expect(merged.claudeMdSections).toBeDefined();
    expect(merged.hooks).toBeDefined();
    expect(merged.settings).toBeDefined();
  });

  it("rules become claudeMd sections with correct markers", () => {
    const merged = harnessToMergedConfig(baseHarness);
    expect(merged.claudeMdSections).toHaveLength(2);
    expect(merged.claudeMdSections[0].id).toBe("rule-1");
    expect(merged.claudeMdSections[0].title).toBe("App Router");
    expect(merged.claudeMdSections[0].content).toBe("## App Router\n\n- Use App Router always");
    expect(merged.claudeMdSections[0].priority).toBe(20);
    expect(merged.claudeMdSections[1].id).toBe("rule-2");
    expect(merged.claudeMdSections[1].priority).toBe(30);
  });

  it("sections are sorted by priority", () => {
    const harness: HarnessConfig = {
      ...baseHarness,
      rules: [
        { id: "low", title: "Low", content: "low", priority: 90 },
        { id: "high", title: "High", content: "high", priority: 10 },
      ],
    };
    const merged = harnessToMergedConfig(harness);
    expect(merged.claudeMdSections[0].id).toBe("high");
    expect(merged.claudeMdSections[1].id).toBe("low");
  });

  it("no longer generates inline enforcement hooks (empty preToolUse/postToolUse)", () => {
    const merged = harnessToMergedConfig(baseHarness);
    // Enforcement is now handled via catalog pipeline, not inline scripts
    expect(merged.hooks.preToolUse).toHaveLength(0);
    expect(merged.hooks.postToolUse).toHaveLength(0);
  });

  it("maps permissions correctly", () => {
    const merged = harnessToMergedConfig(baseHarness);
    expect(merged.settings.permissions.allow).toEqual(["Bash(pnpm test*)"]);
    expect(merged.settings.permissions.deny).toEqual(["Bash(rm -rf /)"]);
  });

  it("populates variables from project stacks", () => {
    const merged = harnessToMergedConfig(baseHarness);
    expect(merged.variables.framework).toBe("nextjs");
    expect(merged.variables.language).toBe("typescript");
    expect(merged.variables.packageManager).toBe("pnpm");
  });

  it("handles empty enforcement gracefully", () => {
    const minimal: HarnessConfig = {
      version: "1.0",
      project: {
        stacks: [{ name: "app", framework: "express", language: "javascript" }],
      },
      rules: [],
      enforcement: {
        preCommit: [],
        blockedPaths: [],
        blockedCommands: [],
        postSave: [],
      },
      hooks: [],
      permissions: { allow: [], deny: [] },
    };
    const merged = harnessToMergedConfig(minimal);
    expect(merged.hooks.preToolUse).toHaveLength(0);
    expect(merged.hooks.postToolUse).toHaveLength(0);
    expect(merged.claudeMdSections).toHaveLength(0);
  });

  it("handles multiple stacks - uses first stack for primary variables", () => {
    const multiStack: HarnessConfig = {
      ...baseHarness,
      project: {
        stacks: [
          { name: "frontend", framework: "nextjs", language: "typescript" },
          { name: "backend", framework: "fastapi", language: "python" },
        ],
      },
    };
    const merged = harnessToMergedConfig(multiStack);
    // First stack provides the primary variables
    expect(merged.variables.framework).toBe("nextjs");
    expect(merged.variables.language).toBe("typescript");
  });
});
