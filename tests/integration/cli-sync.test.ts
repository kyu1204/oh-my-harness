import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { syncCommand } from "../../src/cli/commands/sync.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-sync-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeMinimalHarness(overrides: Record<string, unknown> = {}): string {
  const base = {
    version: "1.0",
    project: {
      name: "test-app",
      stacks: [{ name: "frontend", framework: "react", language: "typescript" }],
    },
    rules: [
      {
        id: "test-rule",
        title: "Test Rule",
        content: "## Test Rule\n\n- Always write tests",
        priority: 50,
      },
    ],
    enforcement: {
      preCommit: [],
      blockedPaths: [],
      blockedCommands: [],
      postSave: [],
    },
    permissions: { allow: [], deny: [] },
    ...overrides,
  };
  return yaml.dump(base, { lineWidth: 120 });
}

describe("syncCommand", () => {
  it("reads harness.yaml and generates CLAUDE.md", async () => {
    const harnessContent = makeMinimalHarness();
    await fs.writeFile(path.join(tmpDir, "harness.yaml"), harnessContent, "utf-8");

    await syncCommand({ projectDir: tmpDir });

    const claudeMd = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("Test Rule");
  });

  it("generates settings.json with permissions", async () => {
    const harnessContent = makeMinimalHarness({
      permissions: { allow: ["Bash(npm test*)"], deny: [] },
    });
    await fs.writeFile(path.join(tmpDir, "harness.yaml"), harnessContent, "utf-8");

    await syncCommand({ projectDir: tmpDir });

    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    const raw = await fs.readFile(settingsPath, "utf-8");
    const settings = JSON.parse(raw);
    expect(settings.permissions.allow).toContain("Bash(npm test*)");
  });

  it("generates hook scripts when hooks block is present", async () => {
    const harnessContent = makeMinimalHarness({
      hooks: [{ block: "branch-guard", params: { mainBranch: "main" } }],
    });
    await fs.writeFile(path.join(tmpDir, "harness.yaml"), harnessContent, "utf-8");

    await syncCommand({ projectDir: tmpDir });

    const hooksDir = path.join(tmpDir, ".omh", "hooks");
    const files = await fs.readdir(hooksDir);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith(".sh"))).toBe(true);
  });

  it("renders template parameters into hook script content", async () => {
    const harnessContent = makeMinimalHarness({
      hooks: [{ block: "branch-guard", params: { mainBranch: "develop" } }],
    });
    await fs.writeFile(path.join(tmpDir, "harness.yaml"), harnessContent, "utf-8");

    await syncCommand({ projectDir: tmpDir });

    const hooksDir = path.join(tmpDir, ".omh", "hooks");
    const files = await fs.readdir(hooksDir);
    const shFile = files.find((f) => f.endsWith(".sh"))!;
    const scriptContent = await fs.readFile(path.join(hooksDir, shFile), "utf-8");
    // The template param {{mainBranch}} should be replaced with "develop"
    expect(scriptContent).toContain("develop");
    expect(scriptContent).not.toContain("{{mainBranch}}");
  });

  it("updates files when synced a second time after harness.yaml changes", async () => {
    // First sync
    const initial = makeMinimalHarness({
      rules: [
        {
          id: "rule-v1",
          title: "Rule V1",
          content: "## Rule V1\n\n- Version one",
          priority: 50,
        },
      ],
    });
    await fs.writeFile(path.join(tmpDir, "harness.yaml"), initial, "utf-8");
    await syncCommand({ projectDir: tmpDir });

    const firstContent = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(firstContent).toContain("Rule V1");

    // Second sync with updated harness.yaml
    const updated = makeMinimalHarness({
      rules: [
        {
          id: "rule-v2",
          title: "Rule V2",
          content: "## Rule V2\n\n- Version two",
          priority: 50,
        },
      ],
    });
    await fs.writeFile(path.join(tmpDir, "harness.yaml"), updated, "utf-8");
    await syncCommand({ projectDir: tmpDir });

    const secondContent = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(secondContent).toContain("Rule V2");
  });
});
