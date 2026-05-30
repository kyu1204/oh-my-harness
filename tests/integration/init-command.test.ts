import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { initCommand } from "../../src/cli/commands/init.js";
import { doctorCommand } from "../../src/cli/commands/doctor.js";
import type { ClaudeRunner } from "../../src/nl/parse-intent.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeNlRunner(overrides: Record<string, unknown> = {}): ClaudeRunner {
  const harnessYaml = yaml.dump({
    version: "1.0",
    project: {
      name: "test-app",
      stacks: [
        { name: "backend", framework: "express", language: "typescript" },
      ],
    },
    rules: [],
    enforcement: {
      preCommit: [],
      blockedPaths: [],
      blockedCommands: [],
      postSave: [],
    },
    hooks: [],
    permissions: { allow: [], deny: [] },
    ...overrides,
  });
  return async () => harnessYaml;
}

describe("initCommand", () => {
  it("generates CLAUDE.md when using nlRunner", async () => {
    const mockRunner = makeNlRunner();
    await initCommand([], { yes: true, projectDir: tmpDir, nlRunner: mockRunner });

    // File must exist (readFile throws if not)
    const claudeMd = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(typeof claudeMd).toBe("string");
  });

  it("saves harness.yaml to project dir", async () => {
    const mockRunner = makeNlRunner();
    await initCommand([], { yes: true, projectDir: tmpDir, nlRunner: mockRunner });

    const savedYaml = await fs.readFile(path.join(tmpDir, "harness.yaml"), "utf-8");
    expect(savedYaml).toContain("test-app");
  });

  it("saves active presets to .claude/oh-my-harness.json", async () => {
    const mockRunner = makeNlRunner();
    await initCommand([], { yes: true, projectDir: tmpDir, nlRunner: mockRunner });

    const stateFile = path.join(tmpDir, ".claude", "oh-my-harness.json");
    const raw = await fs.readFile(stateFile, "utf-8");
    const state = JSON.parse(raw);
    expect(state.presets).toContain("harness");
    expect(state.generatedAt).toBeDefined();
  });

  it("generates settings.json", async () => {
    const mockRunner = makeNlRunner();
    await initCommand([], { yes: true, projectDir: tmpDir, nlRunner: mockRunner });

    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    const raw = await fs.readFile(settingsPath, "utf-8");
    const settings = JSON.parse(raw);
    expect(settings).toHaveProperty("permissions");
  });

  it("updates .gitignore with .omh/state/ entry", async () => {
    const mockRunner = makeNlRunner();
    await initCommand([], { yes: true, projectDir: tmpDir, nlRunner: mockRunner });

    const gitignore = await fs.readFile(path.join(tmpDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".omh/state/");
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

describe("doctorCommand", () => {
  it("returns healthy status after init", async () => {
    const mockRunner = makeNlRunner();
    await initCommand([], { yes: true, projectDir: tmpDir, nlRunner: mockRunner });

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
