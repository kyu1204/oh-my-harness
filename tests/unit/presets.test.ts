import { describe, it, expect } from "vitest";
import { buildPresetHarness, defaultParamsFor, PRESET_NAMES } from "../../src/core/presets.js";
import { HarnessConfigSchema } from "../../src/core/harness-schema.js";
import type { ProjectFacts } from "../../src/detector/types.js";

const tsFacts: ProjectFacts = {
  languages: ["typescript"],
  frameworks: ["nextjs"],
  packageManagers: ["pnpm"],
  testCommands: ["pnpm test"],
  lintCommands: ["npx eslint --fix"],
  buildCommands: ["pnpm build"],
  typecheckCommands: ["npx tsc --noEmit"],
  blockedPaths: [".next/", "node_modules/"],
  detectedFiles: ["package.json", "tsconfig.json"],
};

const pyFacts: ProjectFacts = {
  languages: ["python"],
  frameworks: [],
  packageManagers: ["pip"],
  testCommands: ["pytest"],
  lintCommands: ["ruff check --fix"],
  buildCommands: [],
  typecheckCommands: [],
  blockedPaths: ["__pycache__/", ".venv/"],
  detectedFiles: ["pyproject.toml"],
};

const hooks = (h: { hooks: { block: string }[] }) => h.hooks.map((x) => x.block);

describe("buildPresetHarness (#116)", () => {
  it("exposes minimal, safe and strict", () => {
    expect(PRESET_NAMES).toEqual(["minimal", "safe", "strict"]);
  });

  it("every preset validates against the harness schema, with and without facts, and carries the schema defaults", () => {
    for (const p of PRESET_NAMES) {
      expect(HarnessConfigSchema.safeParse(buildPresetHarness(p, tsFacts)).success).toBe(true);
      expect(HarnessConfigSchema.safeParse(buildPresetHarness(p)).success).toBe(true);
    }
    const h = buildPresetHarness("safe", tsFacts);
    expect(h.loop.enabled).toBe(true);
    expect(h.loop.sentinel).toBe("OMH_GOAL_COMPLETE");
    expect(h.permissions).toEqual({ allow: [], deny: [] });
  });

  it("minimal: only branch, command and path guards", () => {
    const h = buildPresetHarness("minimal", tsFacts);
    expect(hooks(h)).toEqual(["branch-guard", "command-guard", "path-guard"]);
    const pg = h.hooks.find((x) => x.block === "path-guard")!;
    expect(pg.params.blockedPaths).toEqual([".next/", "node_modules/"]);
  });

  it("safe: adds commit gates, lockfile/secret guards and lint-on-save when the facts provide the commands", () => {
    const h = buildPresetHarness("safe", tsFacts);
    expect(hooks(h)).toEqual([
      "branch-guard", "command-guard", "path-guard",
      "commit-test-gate", "commit-typecheck-gate", "lockfile-guard", "secret-file-guard", "lint-on-save",
    ]);
    expect(h.hooks.find((x) => x.block === "commit-test-gate")!.params.testCommand).toBe("pnpm test");
    expect(h.hooks.find((x) => x.block === "commit-typecheck-gate")!.params.typecheckCommand).toBe("npx tsc --noEmit");
    expect(h.hooks.find((x) => x.block === "lint-on-save")!.params).toMatchObject({ filePattern: "*.ts", command: "npx eslint --fix" });
  });

  it("safe: skips blocks whose required params cannot be filled from the facts", () => {
    const h = buildPresetHarness("safe", pyFacts);
    expect(hooks(h)).not.toContain("commit-typecheck-gate");   // no typecheck command for python
    expect(hooks(h)).toContain("commit-test-gate");
    expect(h.hooks.find((x) => x.block === "lint-on-save")!.params.filePattern).toBe("*.py");
  });

  it("strict: adds tdd-guard with language-specific patterns", () => {
    const ts = buildPresetHarness("strict", tsFacts);
    expect(hooks(ts)).toContain("tdd-guard");
    expect(ts.hooks.find((x) => x.block === "tdd-guard")!.params).toEqual({});   // catalog default covers ts/js
    const py = buildPresetHarness("strict", pyFacts);
    expect(py.hooks.find((x) => x.block === "tdd-guard")!.params).toEqual({
      srcPattern: "\\.py$",
      testPattern: "(^|/)(test_[^/]*|[^/]*_test)\\.py$",
    });
  });

  it("without facts: no command-dependent blocks, but still valid and still guarded", () => {
    const h = buildPresetHarness("strict");
    expect(hooks(h)).toEqual(["branch-guard", "command-guard", "lockfile-guard", "secret-file-guard", "tdd-guard"]);
  });

  it("writes rules that describe the preset, and project stacks from the facts", () => {
    const h = buildPresetHarness("strict", tsFacts, { description: "Next.js shop" });
    expect(h.rules.map((r) => r.id)).toEqual(["preset-workflow", "preset-branching", "preset-quality"]);
    expect(h.rules[0].content).toMatch(/test.*before/i);
    expect(h.project.stacks[0]).toMatchObject({ language: "typescript", framework: "nextjs", packageManager: "pnpm", testRunner: "pnpm test" });
    expect(h.project.description).toBe("Next.js shop");
    expect(buildPresetHarness("minimal", tsFacts).rules.map((r) => r.id)).toEqual(["preset-branching", "preset-quality"]);
  });
});

describe("defaultParamsFor", () => {
  it("returns null when a required param has no source", () => {
    expect(defaultParamsFor("commit-test-gate", undefined)).toBeNull();
    expect(defaultParamsFor("path-guard", { ...tsFacts, blockedPaths: [] })).toBeNull();
  });

  it("returns {} for blocks with no required params", () => {
    expect(defaultParamsFor("branch-guard", undefined)).toEqual({});
    expect(defaultParamsFor("sql-guard", undefined)).toEqual({});
    expect(defaultParamsFor("auto-pr", undefined)).toEqual({});
  });

  it("fills format-on-save and test-on-save from the facts", () => {
    expect(defaultParamsFor("test-on-save", pyFacts)).toEqual({ testCommand: "pytest", filePattern: "\\.py$" });
    expect(defaultParamsFor("format-on-save", tsFacts)).toBeNull();   // no formatter detected
  });
});

describe("strict preset and jgrep (#145)", () => {
  it("includes semantic-diff-gate with three generic lints only when jgrep is available", () => {
    const withJgrep = buildPresetHarness("strict", tsFacts, {}, { jgrep: true });
    const gate = withJgrep.hooks.find((h) => h.block === "semantic-diff-gate")!;
    expect(gate).toBeDefined();
    expect(gate.params.rules).toHaveLength(3);
    expect(gate.params.rules).toEqual(expect.arrayContaining([expect.stringMatching(/secret/), expect.stringMatching(/silently ignores/), expect.stringMatching(/skips? a test|disables/)]));
    expect(buildPresetHarness("strict", tsFacts).hooks.map((h) => h.block)).not.toContain("semantic-diff-gate");
    expect(buildPresetHarness("safe", tsFacts, {}, { jgrep: true }).hooks.map((h) => h.block)).not.toContain("semantic-diff-gate");
  });
});
