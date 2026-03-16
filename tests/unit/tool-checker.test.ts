import { describe, it, expect } from "vitest";
import { checkReferencedTools, extractToolNames } from "../../src/cli/tool-checker.js";
import type { ToolCheck } from "../../src/cli/tool-checker.js";
import type { HarnessConfig } from "../../src/core/harness-schema.js";

function makeConfig(overrides: Partial<HarnessConfig["enforcement"]> = {}): HarnessConfig {
  return {
    version: "1.0",
    project: {
      stacks: [{ name: "app", framework: "nextjs", language: "typescript" }],
    },
    rules: [],
    enforcement: {
      preCommit: [],
      blockedPaths: [],
      blockedCommands: [],
      postSave: [],
      ...overrides,
    },
    permissions: { allow: [], deny: [] },
  };
}

describe("extractToolNames", () => {
  it("extracts actual tool from npx prefix with wrapper lookupCommand", () => {
    const config = makeConfig({ preCommit: ["npx vitest run", "npx tsc --noEmit"] });
    const names = extractToolNames(config);
    expect(names).toContainEqual(expect.objectContaining({ name: "vitest", lookupCommand: "npx" }));
    expect(names).toContainEqual(expect.objectContaining({ name: "tsc", lookupCommand: "npx" }));
    expect(names.find((n) => n.name === "npx")).toBeUndefined();
  });

  it("skips npm/pnpm/yarn script commands", () => {
    const config = makeConfig({
      preCommit: ["npm run lint", "pnpm test", "yarn lint", "npm test", "pnpm run build"],
    });
    const names = extractToolNames(config);
    expect(names).toEqual([]);
  });

  it("skips npx option flags and extracts first non-option token", () => {
    const config = makeConfig({ preCommit: ["npx -p typescript tsc"] });
    const names = extractToolNames(config);
    expect(names).toContainEqual(expect.objectContaining({ name: "tsc" }));
    expect(names.find((n) => n.name === "-p")).toBeUndefined();
    expect(names.find((n) => n.name === "typescript")).toBeUndefined();
  });

  it("extracts tool from npx --yes flag", () => {
    const config = makeConfig({ preCommit: ["npx --yes vitest run"] });
    const names = extractToolNames(config);
    expect(names).toContainEqual(expect.objectContaining({ name: "vitest" }));
  });

  it("extracts tool from npm exec subcommand", () => {
    const config = makeConfig({ preCommit: ["npm exec vitest -- --run"] });
    const names = extractToolNames(config);
    expect(names).toContainEqual(expect.objectContaining({ name: "vitest" }));
  });

  it("skips npm run (not npm exec)", () => {
    const config = makeConfig({ preCommit: ["npm run lint"] });
    const names = extractToolNames(config);
    expect(names).toEqual([]);
  });

  it("extracts tool from pnpm dlx", () => {
    const config = makeConfig({ preCommit: ["pnpm dlx vitest"] });
    const names = extractToolNames(config);
    expect(names).toContainEqual(expect.objectContaining({ name: "vitest" }));
  });

  it("extracts tool from pnpm exec", () => {
    const config = makeConfig({ preCommit: ["pnpm exec eslint"] });
    const names = extractToolNames(config);
    expect(names).toContainEqual(expect.objectContaining({ name: "eslint" }));
  });

  it("skips pnpm test (not exec/dlx)", () => {
    const config = makeConfig({ preCommit: ["pnpm test"] });
    const names = extractToolNames(config);
    expect(names).toEqual([]);
  });

  it("extracts tool from yarn dlx", () => {
    const config = makeConfig({ preCommit: ["yarn dlx prettier"] });
    const names = extractToolNames(config);
    expect(names).toContainEqual(expect.objectContaining({ name: "prettier" }));
  });

  it("extracts tool from poetry run with poetry lookupCommand", () => {
    const config = makeConfig({
      preCommit: ["poetry run pytest", "poetry run ruff check"],
    });
    const names = extractToolNames(config);
    expect(names).toContainEqual(expect.objectContaining({ name: "pytest", lookupCommand: "poetry" }));
    expect(names).toContainEqual(expect.objectContaining({ name: "ruff", lookupCommand: "poetry" }));
  });

  it("extracts direct tool names with self lookupCommand", () => {
    const config = makeConfig({
      postSave: [
        { pattern: "*.ts", command: "eslint --fix" },
        { pattern: "*.py", command: "ruff check --fix" },
      ],
    });
    const names = extractToolNames(config);
    expect(names).toContainEqual(expect.objectContaining({ name: "eslint", lookupCommand: "eslint" }));
    expect(names).toContainEqual(expect.objectContaining({ name: "ruff", lookupCommand: "ruff" }));
  });

  it("returns empty array when no commands configured", () => {
    const config = makeConfig();
    const names = extractToolNames(config);
    expect(names).toEqual([]);
  });

  it("deduplicates tool names", () => {
    const config = makeConfig({
      preCommit: ["eslint .", "eslint --fix"],
      postSave: [{ pattern: "*.ts", command: "eslint --fix" }],
    });
    const names = extractToolNames(config);
    const eslintEntries = names.filter((n) => n.name === "eslint");
    expect(eslintEntries.length).toBe(1);
  });

  it("skips gradle wrapper commands", () => {
    const config = makeConfig({ preCommit: ["./gradlew test", "./gradlew build"] });
    const names = extractToolNames(config);
    expect(names).toEqual([]);
  });
});

describe("checkReferencedTools", () => {
  it("checks wrapper existence for npx-wrapped tools", async () => {
    const config = makeConfig({
      preCommit: ["npx vitest run"],
    });
    const results = await checkReferencedTools(config);
    const vitest = results.find((r) => r.name === "vitest");
    expect(vitest).toBeDefined();
    // npx exists on this system, so wrapped tool should be marked installed
    expect(vitest!.installed).toBe(true);
  });

  it("checks wrapper existence for poetry run tools", async () => {
    const config = makeConfig({
      preCommit: ["poetry run pytest"],
    });
    const results = await checkReferencedTools(config);
    const pytest = results.find((r) => r.name === "pytest");
    expect(pytest).toBeDefined();
    // installed depends on whether poetry is on PATH
  });

  it("checks direct tool existence for non-wrapped commands", async () => {
    const config = makeConfig({
      postSave: [{ pattern: "*.ts", command: "eslint --fix" }],
    });
    const results = await checkReferencedTools(config);
    const eslint = results.find((r) => r.name === "eslint");
    expect(eslint).toBeDefined();
    // eslint checked directly via `which eslint`
  });

  it("returns installCmd suggestions", async () => {
    const config = makeConfig({
      postSave: [{ pattern: "*.ts", command: "eslint --fix" }],
    });
    const results = await checkReferencedTools(config);
    for (const tool of results) {
      expect(tool.installCmd).toBeDefined();
      expect(typeof tool.installCmd).toBe("string");
    }
  });

  it("returns empty array for config with no commands", async () => {
    const config = makeConfig();
    const results = await checkReferencedTools(config);
    expect(results).toEqual([]);
  });
});
