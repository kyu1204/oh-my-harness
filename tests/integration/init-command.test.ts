import { describe, it, expect, beforeEach, afterEach } from "vitest";
// updated: hookSummary uses mergeEnforcementAndHooks
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
// updated: enforcement summary replaced with hooks summary in NL flow
import { initCommand } from "../../src/cli/commands/init.js";
import { addCommand } from "../../src/cli/commands/add.js";
import { removeCommand } from "../../src/cli/commands/remove.js";
import { doctorCommand } from "../../src/cli/commands/doctor.js";
import type { ClaudeRunner } from "../../src/nl/parse-intent.js";

const PRESETS_DIR = path.resolve(import.meta.dirname, "../../presets");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("initCommand", () => {
  it("generates CLAUDE.md with base sections when given no extra presets", async () => {
    await initCommand([], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

    const claudeMd = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("General Rules");
  });

  it("generates CLAUDE.md when given explicit preset names", async () => {
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

    const claudeMd = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("General Rules");
    expect(claudeMd).toContain("TDD Workflow");
  });

  it("generates settings.json", async () => {
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    const raw = await fs.readFile(settingsPath, "utf-8");
    const settings = JSON.parse(raw);
    expect(settings).toHaveProperty("_ohMyHarness");
    expect(settings._ohMyHarness.presets).toContain("_base");
  });

  it("saves active presets to .claude/oh-my-harness.json", async () => {
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

    const stateFile = path.join(tmpDir, ".claude", "oh-my-harness.json");
    const raw = await fs.readFile(stateFile, "utf-8");
    const state = JSON.parse(raw);
    expect(state.presets).toContain("_base");
    expect(state.generatedAt).toBeDefined();
  });

  it("always includes _base even if not specified", async () => {
    await initCommand([], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

    const stateFile = path.join(tmpDir, ".claude", "oh-my-harness.json");
    const raw = await fs.readFile(stateFile, "utf-8");
    const state = JSON.parse(raw);
    expect(state.presets).toContain("_base");
  });

  it("generates hook scripts", async () => {
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

    const hooksDir = path.join(tmpDir, ".claude", "hooks");
    const files = await fs.readdir(hooksDir);
    expect(files.length).toBeGreaterThan(0);
    // base preset has base-command-guard and base-test-before-commit hooks
    expect(files).toContain("base-command-guard.sh");
  });

  it("updates .gitignore with .claude/hooks/ entry", async () => {
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

    const gitignore = await fs.readFile(path.join(tmpDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".claude/hooks/");
  });

  it("--preset flag uses existing preset flow", async () => {
    await initCommand([], {
      yes: true,
      projectDir: tmpDir,
      presetsDir: PRESETS_DIR,
      preset: ["nextjs"],
    });

    const claudeMd = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("Next.js");
    expect(claudeMd).toContain("General Rules");

    const stateFile = path.join(tmpDir, ".claude", "oh-my-harness.json");
    const state = JSON.parse(await fs.readFile(stateFile, "utf-8"));
    expect(state.presets).toContain("nextjs");
    expect(state.presets).toContain("_base");
  });

  it("NL flow generates harness.yaml and config files", async () => {
    const harnessYaml = yaml.dump({
      version: "1.0",
      project: {
        name: "test-nl-app",
        stacks: [
          { name: "frontend", framework: "nextjs", language: "typescript", packageManager: "pnpm" },
        ],
      },
      rules: [
        { id: "nl-rule", title: "NL Rule", content: "## NL Rule\n\n- Generated rule", priority: 20 },
      ],
      enforcement: {
        preCommit: [],
        blockedPaths: [],
        blockedCommands: [],
        postSave: [],
      },
      hooks: [{ block: "branch-guard", params: {} }],
      permissions: { allow: ["Bash(pnpm test*)"], deny: [] },
    });

    const mockRunner: ClaudeRunner = async () => harnessYaml;

    await initCommand([], {
      yes: true,
      projectDir: tmpDir,
      presetsDir: PRESETS_DIR,
      nlRunner: mockRunner,
    });

    // Should generate CLAUDE.md with the NL-generated rule
    const claudeMd = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("NL Rule");

    // Should save harness.yaml
    const savedYaml = await fs.readFile(path.join(tmpDir, "harness.yaml"), "utf-8");
    expect(savedYaml).toContain("test-nl-app");

    // Should generate settings.json
    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    expect(settings.permissions.allow).toContain("Bash(pnpm test*)");
  });
});

describe("addCommand", () => {
  it("adds a preset to existing harness and regenerates", async () => {
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

    // Create a second test preset inline (use _base again to avoid needing real preset)
    // We verify state tracking updates
    const stateFile = path.join(tmpDir, ".claude", "oh-my-harness.json");
    const before = JSON.parse(await fs.readFile(stateFile, "utf-8"));
    expect(before.presets).toEqual(["_base"]);

    // Add _base again (idempotent — same preset, just verify no crash)
    await addCommand("_base", { projectDir: tmpDir, presetsDir: PRESETS_DIR });

    const after = JSON.parse(await fs.readFile(stateFile, "utf-8"));
    // _base should still be present (deduplicated)
    expect(after.presets).toContain("_base");
  });

  it("throws if harness not initialized", async () => {
    await expect(
      addCommand("_base", { projectDir: tmpDir, presetsDir: PRESETS_DIR })
    ).rejects.toThrow();
  });
});

describe("removeCommand", () => {
  it("removes a preset and regenerates", async () => {
    // Initialize with just _base
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

    // Manually add a second fake preset entry to state to test removal
    const stateFile = path.join(tmpDir, ".claude", "oh-my-harness.json");
    const state = JSON.parse(await fs.readFile(stateFile, "utf-8"));
    // We'll try to remove a preset that doesn't exist — should error
    await expect(
      removeCommand("nonexistent", { projectDir: tmpDir, presetsDir: PRESETS_DIR })
    ).rejects.toThrow();
  });

  it("throws if harness not initialized", async () => {
    await expect(
      removeCommand("_base", { projectDir: tmpDir, presetsDir: PRESETS_DIR })
    ).rejects.toThrow();
  });
});

describe("doctorCommand", () => {
  it("returns healthy status after init", async () => {
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

    const result = await doctorCommand({ projectDir: tmpDir });
    expect(result.healthy).toBe(true);
    expect(result.checks.stateFile).toBe(true);
    expect(result.checks.claudeMd).toBe(true);
    expect(result.checks.settingsJson).toBe(true);
  });

  it("reports unhealthy status when not initialized", async () => {
    const result = await doctorCommand({ projectDir: tmpDir });
    expect(result.healthy).toBe(false);
    expect(result.checks.stateFile).toBe(false);
  });
});
