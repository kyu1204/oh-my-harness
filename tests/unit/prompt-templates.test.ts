import { describe, it, expect } from "vitest";
import { buildHarnessGenerationPrompt } from "../../src/nl/prompt-templates.js";
import type { ProjectFacts } from "../../src/detector/types.js";

const fullFacts: ProjectFacts = {
  languages: ["typescript", "python"],
  frameworks: ["nextjs"],
  packageManagers: ["pnpm"],
  testCommands: ["pnpm test"],
  lintCommands: ["eslint --fix"],
  buildCommands: ["pnpm build"],
  typecheckCommands: ["tsc --noEmit"],
  blockedPaths: [".next/", "node_modules/", "dist/"],
  detectedFiles: ["package.json", "tsconfig.json"],
};

const emptyFacts: ProjectFacts = {
  languages: [],
  frameworks: [],
  packageManagers: [],
  testCommands: [],
  lintCommands: [],
  buildCommands: [],
  typecheckCommands: [],
  blockedPaths: [],
  detectedFiles: [],
};

describe("buildHarnessGenerationPrompt with projectFacts", () => {
  it("returns same prompt when projectFacts not provided", () => {
    const withoutFacts = buildHarnessGenerationPrompt("my app");
    const withUndefined = buildHarnessGenerationPrompt("my app", undefined, undefined);
    expect(withoutFacts).toBe(withUndefined);
    expect(withoutFacts).not.toContain("Project facts");
  });

  it("includes Project facts section when facts are provided", () => {
    const prompt = buildHarnessGenerationPrompt("my app", undefined, fullFacts);
    expect(prompt).toContain("Project facts (detected automatically):");
  });

  it("includes languages in facts section", () => {
    const prompt = buildHarnessGenerationPrompt("my app", undefined, fullFacts);
    expect(prompt).toContain("- Languages: typescript, python");
  });

  it("includes frameworks in facts section", () => {
    const prompt = buildHarnessGenerationPrompt("my app", undefined, fullFacts);
    expect(prompt).toContain("- Frameworks: nextjs");
  });

  it("includes package managers in facts section", () => {
    const prompt = buildHarnessGenerationPrompt("my app", undefined, fullFacts);
    expect(prompt).toContain("- Package managers: pnpm");
  });

  it("includes test commands in facts section", () => {
    const prompt = buildHarnessGenerationPrompt("my app", undefined, fullFacts);
    expect(prompt).toContain("- Test commands: pnpm test");
  });

  it("includes lint commands in facts section", () => {
    const prompt = buildHarnessGenerationPrompt("my app", undefined, fullFacts);
    expect(prompt).toContain("- Lint commands: eslint --fix");
  });

  it("includes build commands in facts section", () => {
    const prompt = buildHarnessGenerationPrompt("my app", undefined, fullFacts);
    expect(prompt).toContain("- Build commands: pnpm build");
  });

  it("includes typecheck commands in facts section", () => {
    const prompt = buildHarnessGenerationPrompt("my app", undefined, fullFacts);
    expect(prompt).toContain("- Typecheck commands: tsc --noEmit");
  });

  it("includes blocked paths in facts section", () => {
    const prompt = buildHarnessGenerationPrompt("my app", undefined, fullFacts);
    expect(prompt).toContain("- Blocked paths: .next/, node_modules/, dist/");
  });

  it("includes instruction to use detected values", () => {
    const prompt = buildHarnessGenerationPrompt("my app", undefined, fullFacts);
    expect(prompt).toContain("Use these facts when selecting building blocks and generating parameters.");
    expect(prompt).toContain("Do NOT guess commands");
  });

  it("omits Project facts section when all arrays are empty", () => {
    const prompt = buildHarnessGenerationPrompt("my app", undefined, emptyFacts);
    expect(prompt).not.toContain("Project facts");
  });

  it("only shows non-empty fact fields", () => {
    const partialFacts: ProjectFacts = {
      languages: ["typescript"],
      frameworks: [],
      packageManagers: ["npm"],
      testCommands: [],
      lintCommands: [],
      buildCommands: [],
      typecheckCommands: [],
      blockedPaths: [],
      detectedFiles: [],
    };
    const prompt = buildHarnessGenerationPrompt("my app", undefined, partialFacts);
    expect(prompt).toContain("Project facts (detected automatically):");
    expect(prompt).toContain("- Languages: typescript");
    expect(prompt).toContain("- Package managers: npm");
    expect(prompt).not.toContain("- Frameworks:");
    expect(prompt).not.toContain("- Test commands:");
    expect(prompt).not.toContain("- Lint commands:");
    expect(prompt).not.toContain("- Build commands:");
    expect(prompt).not.toContain("- Typecheck commands:");
    expect(prompt).not.toContain("- Blocked paths:");
  });

  it("still includes description when facts are provided", () => {
    const prompt = buildHarnessGenerationPrompt("unique-project-abc", undefined, fullFacts);
    expect(prompt).toContain("unique-project-abc");
  });

  it("works with both catalogBlocks and projectFacts", () => {
    const blocks = [
      {
        id: "branch-guard",
        description: "Blocks commits on merged branches",
        params: [],
      },
    ];
    const prompt = buildHarnessGenerationPrompt("my app", blocks, fullFacts);
    expect(prompt).toContain("branch-guard");
    expect(prompt).toContain("Project facts (detected automatically):");
  });

  it("examples use full executable commands, not bare script names", () => {
    const prompt = buildHarnessGenerationPrompt("my app");
    // preCommit examples should NOT contain bare words like "test", "lint", "build"
    // They should use full commands like "pnpm test", "npx eslint", etc.
    expect(prompt).not.toMatch(/preCommit:\s*\[.*"test".*\]/);
    expect(prompt).not.toMatch(/preCommit:\s*\[.*"lint".*\]/);
    expect(prompt).not.toMatch(/preCommit:\s*\[.*"build".*\]/);
  });

  it("schema description mentions full executable commands", () => {
    const prompt = buildHarnessGenerationPrompt("my app");
    expect(prompt).toContain("full executable shell commands");
  });
});
