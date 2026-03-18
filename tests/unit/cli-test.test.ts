import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
// updated: enforcement removed, only block-based test cases
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
      path.join(hooksDir, "catalog-lockfile-guard.sh"),
      scriptContent,
      { mode: 0o755 },
    );

    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "bash .claude/hooks/catalog-lockfile-guard.sh" }],
          },
        ],
      },
    };
    await fs.writeFile(
      path.join(tmpDir, ".claude", "settings.json"),
      JSON.stringify(settings),
    );

    // harness.yaml with lockfile-guard hook entry
    const harnessYaml = yaml.dump({
      version: "1.0",
      project: { name: "test-project", stacks: [] },
      rules: [],
      enforcement: {},
      hooks: [{ block: "lockfile-guard", params: {} }],
    });
    await fs.writeFile(path.join(tmpDir, "harness.yaml"), harnessYaml);

    const result = await testCommand({ projectDir: tmpDir });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.passed + result.failed).toBeGreaterThan(0);
  });

  it("generates block-based test cases when harness.yaml has hooks[] only (no enforcement)", async () => {
    // settings.json with no registered hooks → empty results
    const settings = { hooks: {} };
    await fs.writeFile(
      path.join(tmpDir, ".claude", "settings.json"),
      JSON.stringify(settings),
    );

    // harness.yaml with only hooks[] (tdd-guard block, no enforcement)
    const harnessYaml = yaml.dump({
      version: "1.0",
      project: { name: "test-project", stacks: [] },
      rules: [],
      enforcement: {},
      hooks: [{ block: "tdd-guard", params: {} }],
    });
    await fs.writeFile(path.join(tmpDir, "harness.yaml"), harnessYaml);

    // testCommand early-exits when no hooks in settings.json
    const result = await testCommand({ projectDir: tmpDir });
    // No hooks registered → returns empty
    expect(result.results).toHaveLength(0);
  });

  it("generates block-based test cases merged with enforcement cases without duplicates", async () => {
    const hooksDir = path.join(tmpDir, ".claude", "hooks");
    const stateDir = path.join(tmpDir, ".claude", "hooks", ".state");
    await fs.mkdir(hooksDir, { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });

    // tdd-guard script
    const tddScript = `#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path":"[^"]*"' | cut -d'"' -f4)
[[ -z "$FILE_PATH" ]] && exit 0
case "$FILE_PATH" in
  *.json|*.yaml|*.yml|*.md|*.sh) exit 0 ;;
esac
if echo "$FILE_PATH" | grep -qE '\\.(test|spec)\\.(ts|tsx|js|jsx)$'; then
  exit 0
fi
if echo "$FILE_PATH" | grep -qE '\\.(ts|tsx|js|jsx)$'; then
  HISTORY=".claude/hooks/.state/edit-history.json"
  if [[ ! -f "$HISTORY" ]]; then
    echo '{"decision":"block","reason":"TDD: write test first"}'
    exit 0
  fi
fi
exit 0
`;
    await fs.writeFile(
      path.join(hooksDir, "catalog-tdd-guard.sh"),
      tddScript,
      { mode: 0o755 },
    );

    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "bash .claude/hooks/catalog-tdd-guard.sh" }],
          },
        ],
      },
    };
    await fs.writeFile(
      path.join(tmpDir, ".claude", "settings.json"),
      JSON.stringify(settings),
    );

    // harness.yaml with hooks[] containing tdd-guard (no enforcement overlap)
    const harnessYaml = yaml.dump({
      version: "1.0",
      project: { name: "test-project", stacks: [] },
      rules: [],
      enforcement: { blockedPaths: [], blockedCommands: [] },
      hooks: [
        { block: "tdd-guard", params: {} },
      ],
    });
    await fs.writeFile(path.join(tmpDir, "harness.yaml"), harnessYaml);

    const result = await testCommand({ projectDir: tmpDir });

    // tdd-guard block cases should be included in results
    const categories = result.results.map((r) => r.testCase.category);
    expect(categories).toContain("tdd-guard");
  });
});

describe("formatCategoryName - additional categories", () => {
  it("returns human-readable name for tdd-guard", () => {
    expect(formatCategoryName("tdd-guard")).toBe("TDD Guard");
  });

  it("returns human-readable name for command-guard", () => {
    expect(formatCategoryName("command-guard")).toBe("Command guards");
  });

  it("returns human-readable name for path-guard", () => {
    expect(formatCategoryName("path-guard")).toBe("File guards");
  });
});
