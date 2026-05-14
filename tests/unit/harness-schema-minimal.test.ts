import { describe, it, expect } from "vitest";
import { HarnessConfigSchema } from "../../src/core/harness-schema.js";

describe("HarnessConfigSchema minimal forms", () => {
  it("accepts an entirely empty yaml object and applies defaults", () => {
    const result = HarnessConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe("1.0");
      expect(result.data.project.stacks).toEqual([]);
      expect(result.data.rules).toEqual([]);
      expect(result.data.hooks).toEqual([]);
      expect(result.data.enforcement.preCommit).toEqual([]);
      expect(result.data.permissions).toEqual({ allow: [], deny: [] });
    }
  });

  it("accepts the README hooks-only example shape", () => {
    const readmeExample = {
      hooks: [
        { block: "branch-guard" },
        { block: "tdd-guard" },
        { block: "commit-test-gate", params: { testCommand: "npx vitest run" } },
        { block: "path-guard", params: { blockedPaths: ["node_modules/", "dist/"] } },
        { block: "command-guard", params: { patterns: ["rm -rf /", "sudo rm"] } },
        { block: "lint-on-save", params: { filePattern: "*.ts", command: "npx eslint --fix" } },
        { block: "auto-pr", params: { baseBranch: "main" } },
      ],
    };
    const result = HarnessConfigSchema.safeParse(readmeExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hooks).toHaveLength(7);
      expect(result.data.project.stacks).toEqual([]);
      expect(result.data.rules).toEqual([]);
    }
  });

  it("accepts project without stacks", () => {
    const result = HarnessConfigSchema.safeParse({ project: { name: "x" } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project.name).toBe("x");
      expect(result.data.project.stacks).toEqual([]);
    }
  });
});
