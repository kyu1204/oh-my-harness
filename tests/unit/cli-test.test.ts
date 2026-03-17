import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { formatCategoryName, testCommand } from "../../src/cli/commands/test.js";

describe("formatCategoryName", () => {
  it("returns human-readable name for known categories", () => {
    expect(formatCategoryName("path-guard")).toBe("File guards");
    expect(formatCategoryName("command-guard")).toBe("Command guards");
    expect(formatCategoryName("branch-guard")).toBe("Branch guard");
    expect(formatCategoryName("lockfile-guard")).toBe("Lockfile guard");
    expect(formatCategoryName("secret-file-guard")).toBe("Secret file guard");
    expect(formatCategoryName("commit-test-gate")).toBe("Pre-commit test gate");
    expect(formatCategoryName("commit-typecheck-gate")).toBe("Pre-commit typecheck gate");
    expect(formatCategoryName("lint-on-save")).toBe("Lint on save");
    expect(formatCategoryName("format-on-save")).toBe("Format on save");
    expect(formatCategoryName("auto-pr")).toBe("Auto PR");
  });

  it("returns the original category name for unknown categories", () => {
    expect(formatCategoryName("unknown-category")).toBe("unknown-category");
    expect(formatCategoryName("custom-hook")).toBe("custom-hook");
  });
});

describe("testCommand", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-test-"));
    await fs.mkdir(path.join(tmpDir, ".claude"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty results when no hooks registered in settings.json", async () => {
    const settings = { hooks: {} };
    await fs.writeFile(
      path.join(tmpDir, ".claude", "settings.json"),
      JSON.stringify(settings),
    );

    const result = await testCommand({ projectDir: tmpDir });

    expect(result.passed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(0);
    expect(result.commandResults).toHaveLength(0);
  });

  it("returns correct structure with passed and failed counts", async () => {
    const settings = { hooks: {} };
    await fs.writeFile(
      path.join(tmpDir, ".claude", "settings.json"),
      JSON.stringify(settings),
    );

    const result = await testCommand({ projectDir: tmpDir });

    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("failed");
    expect(result).toHaveProperty("results");
    expect(result).toHaveProperty("commandResults");
    expect(typeof result.passed).toBe("number");
    expect(typeof result.failed).toBe("number");
    expect(Array.isArray(result.results)).toBe(true);
    expect(Array.isArray(result.commandResults)).toBe(true);
  });

  it("runs tests and returns results for registered hooks with matching scripts", async () => {
    // Set up settings.json with a lockfile-guard hook
    const hooksDir = path.join(tmpDir, ".claude", "hooks");
    await fs.mkdir(hooksDir, { recursive: true });

    // Write a lockfile-guard script that blocks package-lock.json
    const scriptContent = `#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['tool_input'].get('file_path',''))" 2>/dev/null || echo "")
if [[ "$FILE_PATH" == *"package-lock.json"* ]]; then
  echo '{"decision":"block","reason":"lockfile protected"}'
fi
`;
    await fs.writeFile(
      path.join(hooksDir, "lockfile-guard.sh"),
      scriptContent,
      { mode: 0o755 },
    );

    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "bash .claude/hooks/lockfile-guard.sh" }],
          },
        ],
      },
    };
    await fs.writeFile(
      path.join(tmpDir, ".claude", "settings.json"),
      JSON.stringify(settings),
    );

    const result = await testCommand({ projectDir: tmpDir });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.passed + result.failed).toBeGreaterThan(0);
  });
});
