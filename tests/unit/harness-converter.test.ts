import { describe, it, expect } from "vitest";
import { harnessToMergedConfig } from "../../src/core/harness-converter.js";
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
  permissions: {
    allow: ["Bash(pnpm test*)"],
    deny: ["Bash(rm -rf /)"],
  },
};

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

  it("generates correct preCommit hook script from enforcement.preCommit", () => {
    const merged = harnessToMergedConfig(baseHarness);
    const preCommitHook = merged.hooks.preToolUse.find((h) => h.id === "harness-pre-commit");
    expect(preCommitHook).toBeDefined();
    expect(preCommitHook!.matcher).toBe("Bash");
    expect(preCommitHook!.inline).toContain("git commit");
    expect(preCommitHook!.inline).toContain("test");
    expect(preCommitHook!.inline).toContain("lint");
  });

  it("generates file-guard from blockedPaths", () => {
    const merged = harnessToMergedConfig(baseHarness);
    const fileGuard = merged.hooks.preToolUse.find((h) => h.id === "harness-file-guard");
    expect(fileGuard).toBeDefined();
    expect(fileGuard!.matcher).toBe("Edit|Write");
    expect(fileGuard!.inline).toContain(".next/");
    expect(fileGuard!.inline).toContain("node_modules/");
    expect(fileGuard!.inline).toContain("block");
  });

  it("generates command-guard from blockedCommands", () => {
    const merged = harnessToMergedConfig(baseHarness);
    const cmdGuard = merged.hooks.preToolUse.find((h) => h.id === "harness-command-guard");
    expect(cmdGuard).toBeDefined();
    expect(cmdGuard!.matcher).toBe("Bash");
    expect(cmdGuard!.inline).toContain("rm -rf /");
    expect(cmdGuard!.inline).toContain("sudo rm");
    expect(cmdGuard!.inline).toContain("block");
  });

  it("generates postSave hooks", () => {
    const merged = harnessToMergedConfig(baseHarness);
    expect(merged.hooks.postToolUse).toHaveLength(1);
    const postSave = merged.hooks.postToolUse[0];
    expect(postSave.id).toBe("harness-post-save-0");
    expect(postSave.matcher).toBe("Edit|Write");
    expect(postSave.inline).toContain("*.ts");
    expect(postSave.inline).toContain("eslint --fix");
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
