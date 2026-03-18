import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  simulateHook,
  getRegisteredHooks,
  generateBlockTestCases,
  runTestCase,
} from "../../src/cli/harness-tester.js";
import type { TestCase } from "../../src/cli/harness-tester.js";
import { builtinBlocks } from "../../src/catalog/blocks/index.js";

// Helper: write a temp bash script and make it executable
async function writeTempScript(dir: string, name: string, content: string): Promise<string> {
  const scriptPath = path.join(dir, name);
  await fs.writeFile(scriptPath, content, { mode: 0o755 });
  return scriptPath;
}

describe("simulateHook", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-tester-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns block decision when script outputs block JSON", async () => {
    const scriptPath = await writeTempScript(
      tmpDir,
      "block.sh",
      `#!/bin/bash\necho '{"decision":"block","reason":"test block"}'`,
    );
    const result = await simulateHook(scriptPath, {
      tool_name: "Edit",
      tool_input: { file_path: "test.txt" },
    });
    expect(result.decision).toBe("block");
    expect(result.reason).toBe("test block");
  });

  it("returns allow decision when script outputs nothing (empty stdout)", async () => {
    const scriptPath = await writeTempScript(tmpDir, "allow.sh", `#!/bin/bash\nexit 0`);
    const result = await simulateHook(scriptPath, {
      tool_name: "Edit",
      tool_input: { file_path: "test.txt" },
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBeUndefined();
  });

  it("returns allow decision when script exits with error", async () => {
    const scriptPath = await writeTempScript(
      tmpDir,
      "error.sh",
      `#!/bin/bash\nexit 1`,
    );
    const result = await simulateHook(scriptPath, {
      tool_name: "Edit",
      tool_input: { file_path: "test.txt" },
    });
    expect(result.decision).toBe("allow");
  });

  it("returns allow when stdout has no block JSON", async () => {
    const scriptPath = await writeTempScript(
      tmpDir,
      "noblock.sh",
      `#!/bin/bash\necho 'some other output'`,
    );
    const result = await simulateHook(scriptPath, {
      tool_name: "Edit",
      tool_input: { file_path: "test.txt" },
    });
    expect(result.decision).toBe("allow");
  });

  it("parses block JSON embedded in other output", async () => {
    const scriptPath = await writeTempScript(
      tmpDir,
      "embedded.sh",
      `#!/bin/bash\necho 'hook running...'\necho '{"decision":"block","reason":"embedded"}'`,
    );
    const result = await simulateHook(scriptPath, {
      tool_name: "Edit",
      tool_input: { file_path: "test.txt" },
    });
    expect(result.decision).toBe("block");
    expect(result.reason).toBe("embedded");
  });

  it("returns block without reason when block JSON has no reason field", async () => {
    const scriptPath = await writeTempScript(
      tmpDir,
      "block-no-reason.sh",
      `#!/bin/bash\necho '{"decision":"block"}'`,
    );
    const result = await simulateHook(scriptPath, {
      tool_name: "Edit",
      tool_input: { file_path: "test.ts" },
    });
    expect(result.decision).toBe("block");
    expect(result.reason).toBeUndefined();
  });
});

describe("getRegisteredHooks", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-settings-"));
    await fs.mkdir(path.join(tmpDir, ".claude"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("extracts PreToolUse hooks from settings.json", async () => {
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "bash .claude/hooks/file-guard.sh" }],
          },
        ],
      },
    };
    await fs.writeFile(
      path.join(tmpDir, ".claude", "settings.json"),
      JSON.stringify(settings),
    );

    const hooks = await getRegisteredHooks(tmpDir);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].event).toBe("PreToolUse");
    expect(hooks[0].matcher).toBe("Edit");
    expect(hooks[0].command).toBe("bash .claude/hooks/file-guard.sh");
  });

  it("extracts PostToolUse hooks from settings.json", async () => {
    const settings = {
      hooks: {
        PostToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "bash .claude/hooks/command-guard.sh" }],
          },
        ],
      },
    };
    await fs.writeFile(
      path.join(tmpDir, ".claude", "settings.json"),
      JSON.stringify(settings),
    );

    const hooks = await getRegisteredHooks(tmpDir);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].event).toBe("PostToolUse");
  });

  it("extracts hooks from both PreToolUse and PostToolUse", async () => {
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "bash .claude/hooks/file-guard.sh" }],
          },
        ],
        PostToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "bash .claude/hooks/command-guard.sh" }],
          },
        ],
      },
    };
    await fs.writeFile(
      path.join(tmpDir, ".claude", "settings.json"),
      JSON.stringify(settings),
    );

    const hooks = await getRegisteredHooks(tmpDir);
    expect(hooks).toHaveLength(2);
  });

  it("skips hooks that are not type command", async () => {
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "other", command: "bash .claude/hooks/file-guard.sh" }],
          },
        ],
      },
    };
    await fs.writeFile(
      path.join(tmpDir, ".claude", "settings.json"),
      JSON.stringify(settings),
    );

    const hooks = await getRegisteredHooks(tmpDir);
    expect(hooks).toHaveLength(0);
  });

  it("uses empty string for matcher when not set", async () => {
    const settings = {
      hooks: {
        PreToolUse: [
          {
            hooks: [{ type: "command", command: "bash .claude/hooks/file-guard.sh" }],
          },
        ],
      },
    };
    await fs.writeFile(
      path.join(tmpDir, ".claude", "settings.json"),
      JSON.stringify(settings),
    );

    const hooks = await getRegisteredHooks(tmpDir);
    expect(hooks[0].matcher).toBe("");
  });

  it("returns empty array when no hooks configured", async () => {
    const settings = {};
    await fs.writeFile(
      path.join(tmpDir, ".claude", "settings.json"),
      JSON.stringify(settings),
    );

    const hooks = await getRegisteredHooks(tmpDir);
    expect(hooks).toHaveLength(0);
  });
});

describe("runTestCase", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-run-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns error result when hook script does not exist", async () => {
    const testCase: TestCase = {
      name: "missing script test",
      category: "path-guard",
      hookScript: ".claude/hooks/nonexistent.sh",
      input: { tool_name: "Edit", tool_input: { file_path: "test.ts" } },
      expectation: "block",
    };

    const result = await runTestCase(tmpDir, testCase);
    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/Hook script not found/);
    expect(result.actual).toBe("allow");
  });

  it("returns passed true when script decision matches expectation", async () => {
    const scriptDir = path.join(tmpDir, ".claude", "hooks");
    await fs.mkdir(scriptDir, { recursive: true });
    const scriptPath = path.join(scriptDir, "block-guard.sh");
    await fs.writeFile(
      scriptPath,
      `#!/bin/bash\necho '{"decision":"block","reason":"blocked"}'`,
      { mode: 0o755 },
    );

    const testCase: TestCase = {
      name: "block test",
      category: "path-guard",
      hookScript: ".claude/hooks/block-guard.sh",
      input: { tool_name: "Edit", tool_input: { file_path: "dist/test.js" } },
      expectation: "block",
    };

    const result = await runTestCase(tmpDir, testCase);
    expect(result.passed).toBe(true);
    expect(result.actual).toBe("block");
    expect(result.error).toBeUndefined();
  });

  it("returns passed false with error message when decision mismatches", async () => {
    const scriptDir = path.join(tmpDir, ".claude", "hooks");
    await fs.mkdir(scriptDir, { recursive: true });
    const scriptPath = path.join(scriptDir, "allow-guard.sh");
    await fs.writeFile(scriptPath, `#!/bin/bash\nexit 0`, { mode: 0o755 });

    const testCase: TestCase = {
      name: "allow but expect block",
      category: "path-guard",
      hookScript: ".claude/hooks/allow-guard.sh",
      input: { tool_name: "Edit", tool_input: { file_path: "dist/test.js" } },
      expectation: "block",
    };

    const result = await runTestCase(tmpDir, testCase);
    expect(result.passed).toBe(false);
    expect(result.actual).toBe("allow");
    expect(result.error).toMatch(/expected block but got allow/);
  });

  it("includes reason from hook output in result", async () => {
    const scriptDir = path.join(tmpDir, ".claude", "hooks");
    await fs.mkdir(scriptDir, { recursive: true });
    const scriptPath = path.join(scriptDir, "reason-guard.sh");
    await fs.writeFile(
      scriptPath,
      `#!/bin/bash\necho '{"decision":"block","reason":"access denied"}'`,
      { mode: 0o755 },
    );

    const testCase: TestCase = {
      name: "reason test",
      category: "path-guard",
      hookScript: ".claude/hooks/reason-guard.sh",
      input: { tool_name: "Edit", tool_input: { file_path: "dist/test.js" } },
      expectation: "block",
    };

    const result = await runTestCase(tmpDir, testCase);
    expect(result.reason).toBe("access denied");
  });

  it("testCase reference is preserved in result", async () => {
    const testCase: TestCase = {
      name: "missing test",
      category: "path-guard",
      hookScript: ".claude/hooks/missing.sh",
      input: { tool_name: "Edit", tool_input: { file_path: "test.ts" } },
      expectation: "block",
    };

    const result = await runTestCase(tmpDir, testCase);
    expect(result.testCase).toBe(testCase);
  });

  it("calls setup before and teardown after running the hook", async () => {
    const scriptDir = path.join(tmpDir, ".claude", "hooks");
    await fs.mkdir(scriptDir, { recursive: true });
    const scriptPath = path.join(scriptDir, "allow-guard.sh");
    await fs.writeFile(scriptPath, `#!/bin/bash\nexit 0`, { mode: 0o755 });

    const callOrder: string[] = [];
    const testCase: TestCase = {
      name: "setup teardown test",
      category: "path-guard",
      hookScript: ".claude/hooks/allow-guard.sh",
      input: { tool_name: "Edit", tool_input: { file_path: "src/index.ts" } },
      expectation: "allow",
      setup: async () => { callOrder.push("setup"); },
      teardown: async () => { callOrder.push("teardown"); },
    };

    await runTestCase(tmpDir, testCase);
    expect(callOrder).toEqual(["setup", "teardown"]);
  });

  it("calls teardown even when hook simulation throws", async () => {
    const callOrder: string[] = [];
    const testCase: TestCase = {
      name: "teardown on error test",
      category: "path-guard",
      hookScript: ".claude/hooks/nonexistent-will-fail.sh",
      input: { tool_name: "Edit", tool_input: { file_path: "src/index.ts" } },
      expectation: "allow",
      setup: async () => { callOrder.push("setup"); },
      teardown: async () => { callOrder.push("teardown"); },
    };

    // Script doesn't exist, but teardown should still be called
    const result = await runTestCase(tmpDir, testCase);
    expect(result.passed).toBe(false);
    expect(callOrder).toContain("teardown");
  });
});

describe("generateBlockTestCases", () => {
  it("generates block/allow cases for path-guard with blockedPaths params", () => {
    const entries = [{ block: "path-guard", params: { blockedPaths: ["dist/", "node_modules/"] } }];
    const cases = generateBlockTestCases(entries, builtinBlocks);
    expect(cases.filter(c => c.expectation === "block")).toHaveLength(2);
    expect(cases.filter(c => c.expectation === "allow")).toHaveLength(1);
    expect(cases[0].category).toBe("path-guard");
  });

  it("uses registered hook path when provided", () => {
    const entries = [{ block: "path-guard", params: { blockedPaths: ["dist/"] } }];
    const registeredHooks = [
      { event: "PreToolUse", matcher: "Edit|Write", command: "bash .claude/hooks/harness-file-guard.sh" },
    ];
    const cases = generateBlockTestCases(entries, builtinBlocks, undefined, registeredHooks);
    expect(cases[0].hookScript).toBe(".claude/hooks/harness-file-guard.sh");
  });

  it("falls back to catalog- prefix when no registered hook matches", () => {
    const entries = [{ block: "path-guard", params: { blockedPaths: ["dist/"] } }];
    const cases = generateBlockTestCases(entries, builtinBlocks);
    expect(cases[0].hookScript).toBe(".claude/hooks/catalog-path-guard.sh");
  });

  it("generates block/allow cases for command-guard with patterns params", () => {
    const entries = [{ block: "command-guard", params: { patterns: ["rm -rf /", "sudo rm"] } }];
    const cases = generateBlockTestCases(entries, builtinBlocks);
    expect(cases.filter(c => c.expectation === "block")).toHaveLength(2);
    expect(cases.filter(c => c.expectation === "allow")).toHaveLength(1);
  });

  it("generates branch-guard case based on currentBranch", () => {
    const entries = [{ block: "branch-guard", params: {} }];
    const onMain = generateBlockTestCases(entries, builtinBlocks, "main");
    expect(onMain[0].expectation).toBe("block");
    const onFeature = generateBlockTestCases(entries, builtinBlocks, "feat/test");
    expect(onFeature[0].expectation).toBe("allow");
  });

  it("generates tdd-guard cases with setup/teardown", () => {
    const entries = [{ block: "tdd-guard", params: {} }];
    const cases = generateBlockTestCases(entries, builtinBlocks);
    expect(cases.length).toBeGreaterThanOrEqual(3);
    const blockCase = cases.find(c => c.expectation === "block");
    expect(blockCase?.setup).toBeDefined();
  });

  it("generates lockfile-guard cases", () => {
    const entries = [{ block: "lockfile-guard", params: {} }];
    const cases = generateBlockTestCases(entries, builtinBlocks);
    expect(cases.some(c => c.expectation === "block")).toBe(true);
    expect(cases.some(c => c.expectation === "allow")).toBe(true);
  });

  it("generates secret-file-guard cases", () => {
    const entries = [{ block: "secret-file-guard", params: {} }];
    const cases = generateBlockTestCases(entries, builtinBlocks);
    expect(cases.some(c => c.expectation === "block")).toBe(true);
    expect(cases.some(c => c.expectation === "allow")).toBe(true);
  });

  it("skips canBlock=false blocks (lint-on-save)", () => {
    const entries = [{ block: "lint-on-save", params: { filePattern: "*.ts", command: "eslint --fix" } }];
    const cases = generateBlockTestCases(entries, builtinBlocks);
    expect(cases.filter(c => c.expectation === "block")).toHaveLength(0);
  });

  it("skips unknown block ids", () => {
    const entries = [{ block: "nonexistent-block", params: {} }];
    const cases = generateBlockTestCases(entries, builtinBlocks);
    expect(cases).toHaveLength(0);
  });

  it("applies defaults for blocks with optional params", () => {
    const entries = [{ block: "tdd-guard", params: {} }];
    const cases = generateBlockTestCases(entries, builtinBlocks);
    expect(cases.length).toBeGreaterThan(0);
  });
});
