import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  simulateHook,
  getRegisteredHooks,
  generateTestCases,
  runTestCase,
} from "../../src/cli/harness-tester.js";
import type { TestCase } from "../../src/cli/harness-tester.js";

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

describe("generateTestCases", () => {
  it("generates block and allow cases for path-guard hooks from blockedPaths", () => {
    const hooks = [
      { event: "PreToolUse", matcher: "Edit", command: "bash .claude/hooks/path-guard.sh" },
    ];
    const cases = generateTestCases(hooks, { blockedPaths: ["dist/", "*.lock"] });

    const blocked = cases.filter((c) => c.expectation === "block");
    const allowed = cases.filter((c) => c.expectation === "allow");

    expect(blocked.length).toBeGreaterThanOrEqual(2);
    expect(allowed.length).toBeGreaterThanOrEqual(1);
  });

  it("generates path-guard cases with correct tool_name Edit", () => {
    const hooks = [
      { event: "PreToolUse", matcher: "Edit", command: "bash .claude/hooks/file-guard.sh" },
    ];
    const cases = generateTestCases(hooks, { blockedPaths: [".env"] });

    const guardCases = cases.filter((c) => c.category === "path-guard");
    for (const c of guardCases) {
      expect(c.input.tool_name).toBe("Edit");
      expect(c.input.tool_input).toHaveProperty("file_path");
    }
  });

  it("generates path test with trailing slash appended with filename", () => {
    const hooks = [
      { event: "PreToolUse", matcher: "Edit", command: "bash .claude/hooks/path-guard.sh" },
    ];
    const cases = generateTestCases(hooks, { blockedPaths: ["dist/"] });

    const distCase = cases.find(
      (c) => c.expectation === "block" && String(c.input.tool_input.file_path).startsWith("dist/"),
    );
    expect(distCase).toBeDefined();
  });

  it("generates command-guard cases from blockedCommands", () => {
    const hooks = [
      { event: "PreToolUse", matcher: "Bash", command: "bash .claude/hooks/command-guard.sh" },
    ];
    const cases = generateTestCases(hooks, { blockedCommands: ["rm -rf /", "git push --force"] });

    const blocked = cases.filter((c) => c.expectation === "block" && c.category === "command-guard");
    const allowed = cases.filter((c) => c.expectation === "allow" && c.category === "command-guard");

    expect(blocked).toHaveLength(2);
    expect(allowed).toHaveLength(1);
  });

  it("generates command-guard cases with correct tool_name Bash", () => {
    const hooks = [
      { event: "PreToolUse", matcher: "Bash", command: "bash .claude/hooks/command-guard.sh" },
    ];
    const cases = generateTestCases(hooks, { blockedCommands: ["rm -rf /"] });

    const guardCases = cases.filter((c) => c.category === "command-guard");
    for (const c of guardCases) {
      expect(c.input.tool_name).toBe("Bash");
      expect(c.input.tool_input).toHaveProperty("command");
    }
  });

  it("generates branch-guard cases", () => {
    const hooks = [
      { event: "PreToolUse", matcher: "Bash", command: "bash .claude/hooks/branch-guard.sh" },
    ];
    const cases = generateTestCases(hooks, {});

    const branchCases = cases.filter((c) => c.category === "branch-guard");
    expect(branchCases).toHaveLength(1);
    expect(branchCases[0].expectation).toBe("allow");
  });

  it("generates lockfile-guard cases", () => {
    const hooks = [
      { event: "PreToolUse", matcher: "Edit", command: "bash .claude/hooks/lockfile-guard.sh" },
    ];
    const cases = generateTestCases(hooks, {});

    const lockfileCases = cases.filter((c) => c.category === "lockfile-guard");
    const blocked = lockfileCases.filter((c) => c.expectation === "block");
    const allowed = lockfileCases.filter((c) => c.expectation === "allow");

    expect(blocked).toHaveLength(1);
    expect(allowed).toHaveLength(1);
    expect(blocked[0].input.tool_input.file_path).toBe("package-lock.json");
    expect(allowed[0].input.tool_input.file_path).toBe("package.json");
  });

  it("generates secret-file-guard cases", () => {
    const hooks = [
      { event: "PreToolUse", matcher: "Edit", command: "bash .claude/hooks/secret-file-guard.sh" },
    ];
    const cases = generateTestCases(hooks, {});

    const secretCases = cases.filter((c) => c.category === "secret-file-guard");
    const blocked = secretCases.filter((c) => c.expectation === "block");
    const allowed = secretCases.filter((c) => c.expectation === "allow");

    expect(blocked).toHaveLength(1);
    expect(allowed).toHaveLength(1);
    expect(blocked[0].input.tool_input.file_path).toBe(".env");
  });

  it("strips bash prefix from hook command for hookScript", () => {
    const hooks = [
      { event: "PreToolUse", matcher: "Edit", command: "bash .claude/hooks/lockfile-guard.sh" },
    ];
    const cases = generateTestCases(hooks, {});

    for (const c of cases) {
      expect(c.hookScript).not.toMatch(/^bash\s+/);
    }
  });

  it("returns empty array when no matching hooks", () => {
    const hooks = [
      { event: "PreToolUse", matcher: "Edit", command: "bash .claude/hooks/unknown-guard.sh" },
    ];
    const cases = generateTestCases(hooks, { blockedPaths: [], blockedCommands: [] });
    expect(cases).toHaveLength(0);
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
});
