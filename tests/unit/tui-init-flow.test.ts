import { describe, it, expect } from "vitest";
import { formatDepResults, formatConfigSummary, formatProjectFacts } from "../../src/cli/tui/init-flow.js";
import type { DepCheck } from "../../src/cli/deps-checker.js";
import type { HarnessConfig } from "../../src/core/harness-schema.js";
import { emptyFacts } from "../../src/detector/types.js";

describe("formatDepResults", () => {
  it("formats installed deps with checkmark and version", () => {
    const deps: DepCheck[] = [
      {
        name: "git",
        command: "git --version",
        required: true,
        purpose: "Version control",
        installHint: "brew install git",
        installed: true,
        version: "2.43.0",
      },
    ];
    const output = formatDepResults(deps);
    expect(output).toContain("git");
    expect(output).toContain("2.43.0");
  });

  it("formats missing required deps with error indicator", () => {
    const deps: DepCheck[] = [
      {
        name: "jq",
        command: "jq --version",
        required: true,
        purpose: "Parses tool input in hook scripts",
        installHint: "brew install jq",
        installed: false,
      },
    ];
    const output = formatDepResults(deps);
    expect(output).toContain("jq");
    expect(output).toContain("missing");
  });

  it("formats missing optional deps with warning indicator", () => {
    const deps: DepCheck[] = [
      {
        name: "claude",
        command: "claude --version",
        required: false,
        purpose: "Enables natural language harness generation",
        installHint: "npm install -g @anthropic-ai/claude-code",
        installed: false,
      },
    ];
    const output = formatDepResults(deps);
    expect(output).toContain("claude");
    expect(output).toContain("optional");
  });

  it("handles empty deps array", () => {
    const output = formatDepResults([]);
    expect(output).toBe("");
  });
});

describe("formatConfigSummary", () => {
  it("includes project name and stack info", () => {
    const config: HarnessConfig = {
      version: "1.0",
      project: {
        name: "my-app",
        description: "A test project",
        stacks: [{ name: "frontend", framework: "nextjs", language: "typescript" }],
      },
      rules: [{ id: "r1", title: "TDD Mandatory", content: "content", priority: 10 }],
      enforcement: {
        preCommit: [],
        blockedPaths: [],
        blockedCommands: [],
        postSave: [],
      },
      hooks: [
        { block: "commit-test-gate", params: { testCommand: "npx vitest run" } },
        { block: "path-guard", params: { blockedPaths: ["dist/"] } },
        { block: "lint-on-save", params: { filePattern: "*.ts", command: "eslint --fix" } },
      ],
      permissions: { allow: [], deny: [] },
    };
    const output = formatConfigSummary(config);
    expect(output).toContain("my-app");
    expect(output).toContain("nextjs");
    expect(output).toContain("typescript");
  });

  it("includes rules summary", () => {
    const config: HarnessConfig = {
      version: "1.0",
      project: {
        stacks: [{ name: "app", framework: "react", language: "typescript" }],
      },
      rules: [
        { id: "r1", title: "TDD Mandatory", content: "content", priority: 10 },
        { id: "r2", title: "TypeScript Rules", content: "content", priority: 20 },
      ],
      enforcement: { preCommit: [], blockedPaths: [], blockedCommands: [], postSave: [] },
      hooks: [],
      permissions: { allow: [], deny: [] },
    };
    const output = formatConfigSummary(config);
    expect(output).toContain("TDD Mandatory");
    expect(output).toContain("TypeScript Rules");
  });

  it("includes hooks summary", () => {
    const config: HarnessConfig = {
      version: "1.0",
      project: {
        stacks: [{ name: "app", framework: "react", language: "typescript" }],
      },
      rules: [],
      enforcement: { preCommit: [], blockedPaths: [], blockedCommands: [], postSave: [] },
      hooks: [
        { block: "commit-test-gate", params: { testCommand: "npx vitest run" } },
        { block: "path-guard", params: { blockedPaths: ["dist/", "node_modules/"] } },
        { block: "lint-on-save", params: { filePattern: "*.ts", command: "eslint --fix" } },
      ],
      permissions: { allow: [], deny: [] },
    };
    const output = formatConfigSummary(config);
    expect(output).toContain("commit-test-gate");
    expect(output).toContain("path-guard");
    expect(output).toContain("lint-on-save");
  });

  it("shows enforcement-derived hooks when enforcement is present", () => {
    const config: HarnessConfig = {
      version: "1.0",
      project: {
        stacks: [{ name: "app", framework: "react", language: "typescript" }],
      },
      rules: [],
      enforcement: {
        preCommit: ["npx vitest run", "npx tsc --noEmit"],
        blockedPaths: ["dist/", "node_modules/"],
        blockedCommands: [],
        postSave: [{ pattern: "*.ts", command: "eslint --fix" }],
      },
      hooks: [],
      permissions: { allow: [], deny: [] },
    };
    const output = formatConfigSummary(config);
    // enforcement is auto-converted to hooks for display
    expect(output).toContain("commit-test-gate");
    expect(output).toContain("commit-typecheck-gate");
    expect(output).toContain("path-guard");
    expect(output).toContain("lint-on-save");
  });

  it("handles config with no hooks and no enforcement", () => {
    const config: HarnessConfig = {
      version: "1.0",
      project: {
        stacks: [{ name: "app", framework: "react", language: "typescript" }],
      },
      rules: [],
      enforcement: { preCommit: [], blockedPaths: [], blockedCommands: [], postSave: [] },
      hooks: [],
      permissions: { allow: [], deny: [] },
    };
    const output = formatConfigSummary(config);
    expect(typeof output).toBe("string");
  });
});

describe("formatProjectFacts", () => {
  it("displays detected languages and frameworks", () => {
    const facts = {
      ...emptyFacts(),
      languages: ["typescript"],
      frameworks: ["nextjs"],
      packageManagers: ["pnpm"],
      testCommands: ["pnpm test"],
      lintCommands: ["eslint --fix"],
    };
    const output = formatProjectFacts(facts);
    expect(output).toContain("typescript");
    expect(output).toContain("nextjs");
    expect(output).toContain("pnpm");
    expect(output).toContain("pnpm test");
    expect(output).toContain("eslint --fix");
  });

  it("omits empty fields", () => {
    const facts = {
      ...emptyFacts(),
      languages: ["go"],
      testCommands: ["go test ./..."],
    };
    const output = formatProjectFacts(facts);
    expect(output).toContain("go");
    expect(output).toContain("go test ./...");
    expect(output).not.toContain("Frameworks");
    expect(output).not.toContain("Package managers");
  });

  it("shows fallback message for empty facts", () => {
    const output = formatProjectFacts(emptyFacts());
    expect(output).toContain("No project signals detected");
  });
});
