import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractExecutable,
  checkCommandExecutable,
  extractPreCommitCommands,
  extractPostSaveCommands,
  checkHarnessCommands,
} from "../../src/cli/command-checker.js";

describe("extractExecutable", () => {
  it("extracts binary from npm run command", () => {
    expect(extractExecutable("npm test")).toBe("npm");
  });

  it("extracts binary from npx command", () => {
    expect(extractExecutable("npx tsc --noEmit")).toBe("npx");
  });

  it("extracts binary from direct eslint command", () => {
    expect(extractExecutable("eslint --fix")).toBe("eslint");
  });

  it("handles leading whitespace", () => {
    expect(extractExecutable("  bash script.sh")).toBe("bash");
  });
});

describe("checkCommandExecutable", () => {
  it("returns true for node which is installed", async () => {
    const result = await checkCommandExecutable("node");
    expect(result).toBe(true);
  });

  it("returns false for nonexistent tool", async () => {
    const result = await checkCommandExecutable("nonexistent-tool-xyz");
    expect(result).toBe(false);
  });
});

describe("extractPreCommitCommands", () => {
  it("extracts command from single if ! pattern", () => {
    const content = `#!/bin/bash
if ! npm test >&2 2>&1; then
  exit 1
fi`;
    const commands = extractPreCommitCommands(content);
    expect(commands).toEqual(["npm test"]);
  });

  it("extracts multiple commands from multiple if ! patterns", () => {
    const content = `#!/bin/bash
if ! npm test >&2 2>&1; then
  exit 1
fi
if ! npx tsc --noEmit >&2 2>&1; then
  exit 1
fi`;
    const commands = extractPreCommitCommands(content);
    expect(commands).toEqual(["npm test", "npx tsc --noEmit"]);
  });

  it("returns empty array when no if ! patterns found", () => {
    const content = `#!/bin/bash
echo "no commands here"`;
    const commands = extractPreCommitCommands(content);
    expect(commands).toEqual([]);
  });
});

describe("extractPostSaveCommands", () => {
  it("extracts eslint --fix command", () => {
    const content = `#!/bin/bash
FILE_PATH="$1"
eslint --fix "$FILE_PATH"`;
    const commands = extractPostSaveCommands(content);
    expect(commands).toEqual(["eslint --fix"]);
  });

  it("excludes comment lines", () => {
    const content = `#!/bin/bash
# eslint --fix "$FILE_PATH"
prettier --write "$FILE_PATH"`;
    const commands = extractPostSaveCommands(content);
    expect(commands).toEqual(["prettier --write"]);
  });

  it("excludes FILE_PATH assignment lines", () => {
    const content = `#!/bin/bash
FILE_PATH="$FILE_PATH"
eslint "$FILE_PATH"`;
    const commands = extractPostSaveCommands(content);
    expect(commands).toEqual(["eslint"]);
  });

  it("excludes BASENAME=$(basename) lines", () => {
    const content = `#!/bin/bash
BASENAME=$(basename "$FILE_PATH")
if [[ "$BASENAME" == $PATTERN ]]; then
  echo "oh-my-harness: Running eslint --fix on $FILE_PATH..." >&2
  eslint --fix "$FILE_PATH" >&2 2>&1 || true
fi`;
    const commands = extractPostSaveCommands(content);
    expect(commands).not.toContainEqual(expect.stringContaining("BASENAME"));
    expect(commands).toContain("eslint --fix");
  });

  it("returns empty array when no $FILE_PATH patterns found", () => {
    const content = `#!/bin/bash
echo "no file path here"`;
    const commands = extractPostSaveCommands(content);
    expect(commands).toEqual([]);
  });
});

describe("checkHarnessCommands", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = join(tmpdir(), `omh-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });

    // Create a pre-commit test gate script
    await writeFile(
      join(tmpDir, "pre-commit-test-gate.sh"),
      `#!/bin/bash
if ! npm test >&2 2>&1; then
  exit 1
fi
`,
      "utf-8",
    );

    // Create a lint-on-save script
    await writeFile(
      join(tmpDir, "lint-on-save.sh"),
      `#!/bin/bash
FILE_PATH="$1"
eslint --fix "$FILE_PATH"
`,
      "utf-8",
    );

    // Create an auto-pr script
    await writeFile(
      join(tmpDir, "auto-pr.sh"),
      `#!/bin/bash
gh pr create --fill
`,
      "utf-8",
    );
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("extracts and checks commands from pre-commit gate script", async () => {
    const hooks = [
      { event: "PreToolUse", matcher: "Bash", command: `bash pre-commit-test-gate.sh` },
    ];
    const results = await checkHarnessCommands(hooks, tmpDir);
    expect(results.length).toBeGreaterThan(0);
    const npmResult = results.find((r) => r.command === "npm test");
    expect(npmResult).toBeDefined();
    expect(npmResult!.category).toBe("commit-test-gate");
    expect(typeof npmResult!.executable).toBe("boolean");
  });

  it("extracts and checks commands from lint-on-save script", async () => {
    const hooks = [
      { event: "PostToolUse", matcher: "Edit", command: `bash lint-on-save.sh` },
    ];
    const results = await checkHarnessCommands(hooks, tmpDir);
    expect(results.length).toBeGreaterThan(0);
    const eslintResult = results.find((r) => r.command === "eslint --fix");
    expect(eslintResult).toBeDefined();
    expect(eslintResult!.category).toBe("lint-on-save");
  });

  it("checks gh CLI for auto-pr script", async () => {
    const hooks = [
      { event: "PostToolUse", matcher: "Bash", command: `bash auto-pr.sh` },
    ];
    const results = await checkHarnessCommands(hooks, tmpDir);
    const ghResult = results.find((r) => r.command === "gh");
    expect(ghResult).toBeDefined();
    expect(ghResult!.category).toBe("auto-pr");
    expect(typeof ghResult!.executable).toBe("boolean");
  });

  it("categorizes typecheck command as commit-typecheck-gate by content", async () => {
    await writeFile(
      join(tmpDir, "custom-gate.sh"),
      `#!/bin/bash
if ! tsc --noEmit >&2 2>&1; then
  exit 1
fi
`,
      "utf-8",
    );
    const hooks = [
      { event: "PreToolUse", matcher: "Bash", command: `bash custom-gate.sh` },
    ];
    const results = await checkHarnessCommands(hooks, tmpDir);
    const tscResult = results.find((r) => r.command === "tsc --noEmit");
    expect(tscResult).toBeDefined();
    expect(tscResult!.category).toBe("commit-typecheck-gate");
  });

  it("detects pre-commit gate by content even if filename differs", async () => {
    await writeFile(
      join(tmpDir, "harness-custom-gate.sh"),
      `#!/bin/bash
if ! npm test >&2 2>&1; then
  exit 1
fi
`,
      "utf-8",
    );
    const hooks = [
      { event: "PreToolUse", matcher: "Bash", command: `bash harness-custom-gate.sh` },
    ];
    const results = await checkHarnessCommands(hooks, tmpDir);
    expect(results.length).toBeGreaterThan(0);
    const npmResult = results.find((r) => r.command === "npm test");
    expect(npmResult).toBeDefined();
    expect(npmResult!.category).toBe("commit-test-gate");
  });

  it("skips hooks whose script file does not exist", async () => {
    const hooks = [
      { event: "PreToolUse", matcher: "Bash", command: `bash nonexistent-script.sh` },
    ];
    const results = await checkHarnessCommands(hooks, tmpDir);
    expect(results).toEqual([]);
  });

  it("returns empty array for empty hooks list", async () => {
    const results = await checkHarnessCommands([], tmpDir);
    expect(results).toEqual([]);
  });
});
