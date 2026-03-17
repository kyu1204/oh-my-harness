import { describe, it, expect } from "vitest";
import { HarnessConfigSchema } from "../../src/core/harness-schema.js";
import type { HarnessConfig } from "../../src/core/harness-schema.js";

const validConfig: HarnessConfig = {
  version: "1.0",
  project: {
    name: "my-app",
    description: "A full-stack web app",
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
      title: "Use App Router",
      content: "## App Router\n\n- Always use App Router",
      priority: 20,
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

describe("HarnessConfigSchema", () => {
  it("validates a correct harness config", () => {
    const result = HarnessConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe("1.0");
      expect(result.data.project.stacks).toHaveLength(1);
      expect(result.data.rules).toHaveLength(1);
      expect(result.data.enforcement.preCommit).toEqual(["test", "lint"]);
      expect(result.data.permissions.allow).toEqual(["Bash(pnpm test*)"]);
    }
  });

  it("rejects invalid config (missing required fields)", () => {
    // Missing project.stacks[].name
    const invalid = {
      version: "1.0",
      project: {
        stacks: [{ framework: "nextjs", language: "typescript" }],
      },
      rules: [],
      enforcement: { preCommit: [] },
    };
    const result = HarnessConfigSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects invalid version", () => {
    const result = HarnessConfigSchema.safeParse({ ...validConfig, version: "2.0" });
    expect(result.success).toBe(false);
  });

  it("applies defaults correctly", () => {
    const minimal = {
      project: {
        stacks: [{ name: "api", framework: "fastapi", language: "python" }],
      },
      rules: [],
      enforcement: {},
    };
    const result = HarnessConfigSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe("1.0");
      expect(result.data.enforcement.preCommit).toEqual([]);
      expect(result.data.enforcement.blockedPaths).toEqual([]);
      expect(result.data.enforcement.blockedCommands).toEqual([]);
      expect(result.data.enforcement.postSave).toEqual([]);
      expect(result.data.permissions).toEqual({ allow: [], deny: [] });
    }
  });

  it("allows optional project fields", () => {
    const config = {
      project: {
        stacks: [{ name: "backend", framework: "express", language: "javascript" }],
      },
      rules: [],
      enforcement: {},
    };
    const result = HarnessConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project.name).toBeUndefined();
      expect(result.data.project.description).toBeUndefined();
    }
  });

  it("defaults enforcement when omitted entirely", () => {
    const config = {
      project: {
        stacks: [{ name: "app", framework: "react", language: "typescript" }],
      },
      rules: [],
    };
    const result = HarnessConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enforcement).toEqual({
        preCommit: [],
        blockedPaths: [],
        blockedCommands: [],
        postSave: [],
      });
    }
  });

  it("defaults hooks[].params when omitted", () => {
    const config = {
      project: {
        stacks: [{ name: "app", framework: "react", language: "typescript" }],
      },
      rules: [],
      hooks: [{ block: "branch-guard" }],
    };
    const result = HarnessConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hooks[0].params).toEqual({});
    }
  });

  it("validates rule priority defaults to 50", () => {
    const config = {
      project: {
        stacks: [{ name: "app", framework: "react", language: "typescript" }],
      },
      rules: [{ id: "r1", title: "Rule 1", content: "content" }],
      enforcement: {},
    };
    const result = HarnessConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rules[0].priority).toBe(50);
    }
  });
});
