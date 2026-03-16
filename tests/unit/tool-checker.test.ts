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
  it("extracts actual tool from npx prefix", () => {
    const config = makeConfig({ preCommit: ["npx vitest run", "npx tsc --noEmit"] });
    const names = extractToolNames(config);
    expect(names).toContainEqual(expect.objectContaining({ name: "vitest", source: "pre-commit" }));
    expect(names).toContainEqual(expect.objectContaining({ name: "tsc", source: "pre-commit" }));
    expect(names.find((n) => n.name === "npx")).toBeUndefined();
  });

  it("skips npm/pnpm/yarn script commands", () => {
    const config = makeConfig({
      preCommit: ["npm run lint", "pnpm test", "yarn lint", "npm test", "pnpm run build"],
    });
    const names = extractToolNames(config);
    expect(names).toEqual([]);
  });

  it("extracts tool from poetry run prefix", () => {
    const config = makeConfig({
      preCommit: ["poetry run pytest", "poetry run ruff check"],
    });
    const names = extractToolNames(config);
    expect(names).toContainEqual(expect.objectContaining({ name: "pytest" }));
    expect(names).toContainEqual(expect.objectContaining({ name: "ruff" }));
  });

  it("extracts direct tool names from postSave commands", () => {
    const config = makeConfig({
      postSave: [
        { pattern: "*.ts", command: "eslint --fix" },
        { pattern: "*.py", command: "ruff check --fix" },
      ],
    });
    const names = extractToolNames(config);
    expect(names).toContainEqual(expect.objectContaining({ name: "eslint", source: "post-save hook" }));
    expect(names).toContainEqual(expect.objectContaining({ name: "ruff", source: "post-save hook" }));
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
  it("checks if referenced tools exist on system", async () => {
    const config = makeConfig({
      preCommit: ["npx vitest run"],
      postSave: [{ pattern: "*.ts", command: "eslint --fix" }],
    });
    const results = await checkReferencedTools(config);
    expect(Array.isArray(results)).toBe(true);
    // vitest should be extracted from "npx vitest run"
    const vitest = results.find((r) => r.name === "vitest");
    expect(vitest).toBeDefined();
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
