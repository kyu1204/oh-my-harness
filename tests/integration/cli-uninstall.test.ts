import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { syncCommand } from "../../src/cli/commands/sync.js";
import { uninstallCommand } from "../../src/cli/commands/uninstall.js";

let projectDir: string;

function captureConsole(): { output: () => string; restore: () => void } {
  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join(" ")); });
  const error = vi.spyOn(console, "error").mockImplementation((...args) => { lines.push(args.join(" ")); });
  return {
    output: () => lines.join("\n"),
    restore: () => {
      log.mockRestore();
      error.mockRestore();
    },
  };
}

async function withConsole<T>(fn: () => Promise<T>): Promise<{ result: T; output: string }> {
  const cap = captureConsole();
  try {
    const result = await fn();
    return { result, output: cap.output() };
  } finally {
    cap.restore();
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function harnessYaml(): string {
  return yaml.dump(
    {
      version: "1.0",
      project: { name: "uninstall-test", stacks: [{ name: "frontend", framework: "react", language: "typescript" }] },
      rules: [{ id: "rule", title: "Rule", content: "managed rule", priority: 50 }],
      permissions: { allow: ["Bash(pnpm test*)"], deny: ["Bash(rm -rf /)"] },
      hooks: [{ block: "command-guard", params: { patterns: ["DO_NOT_RUN"] } }],
    },
    { lineWidth: 120 },
  );
}

async function prepareSyncedProject(): Promise<void> {
  await fs.writeFile(path.join(projectDir, "harness.yaml"), harnessYaml(), "utf8");
  await syncCommand({ projectDir });

  await fs.appendFile(path.join(projectDir, "CLAUDE.md"), "\nuser claude note\n", "utf8");
  await fs.appendFile(path.join(projectDir, "AGENTS.md"), "\nuser agents note\n", "utf8");

  const settingsPath = path.join(projectDir, ".claude", "settings.json");
  const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  settings.permissions.allow.push("Bash(git push)");
  settings.hooks.PreToolUse.push({
    matcher: "Bash",
    hooks: [{ type: "command", command: "node custom-claude-hook.js" }],
  });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");

  const codexConfigPath = path.join(projectDir, ".codex", "config.toml");
  await fs.appendFile(
    codexConfigPath,
    [
      "",
      "[[hooks.PreToolUse]]",
      'matcher = "^Bash$"',
      "",
      "[[hooks.PreToolUse.hooks]]",
      'type = "command"',
      'command = "python3 inline-user-hook.py"',
      "",
      "[mcp_servers.foo]",
      'command = "bar"',
      "",
    ].join("\n"),
    "utf8",
  );

  const codexHooksPath = path.join(projectDir, ".codex", "hooks.json");
  const codexHooks = JSON.parse(await fs.readFile(codexHooksPath, "utf8"));
  codexHooks.hooks.PreToolUse.unshift({
    matcher: "Bash",
    hooks: [{ type: "command", command: "python3 user-codex-hook.py" }],
  });
  await fs.writeFile(codexHooksPath, JSON.stringify(codexHooks, null, 2) + "\n", "utf8");

  await fs.writeFile(path.join(projectDir, ".pi", "extensions", "custom.ts"), "export default 'user';\n", "utf8");
}

beforeEach(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-uninstall-cli-"));
});

afterEach(async () => {
  await fs.rm(projectDir, { recursive: true, force: true });
});

describe("uninstallCommand", () => {
  it("dry-run prints destructive warnings and does not write", async () => {
    await prepareSyncedProject();
    const before = await fs.readFile(path.join(projectDir, ".claude", "settings.json"), "utf8");

    const { result, output } = await withConsole(() => uninstallCommand({ projectDir, dryRun: true }));

    expect(result.exitCode).toBe(0);
    expect(output).toContain("oh-my-harness uninstall plan");
    expect(output).toContain("백업 후 실행 권장");
    expect(output).toContain("[features].hooks/goals");
    expect(output).toContain("comments");
    await expect(fs.readFile(path.join(projectDir, ".claude", "settings.json"), "utf8")).resolves.toBe(before);
  });

  it("removes generated artifacts and preserves user content", async () => {
    await prepareSyncedProject();

    const { result, output } = await withConsole(() => uninstallCommand({ projectDir, yes: true }));

    expect(result.exitCode).toBe(0);
    expect(output).toContain("modified:");
    expect(output).toContain("deleted:");
    await expect(exists(path.join(projectDir, ".omh"))).resolves.toBe(false);
    await expect(exists(path.join(projectDir, ".pi", "extensions", "omh-harness.ts"))).resolves.toBe(false);
    await expect(fs.readFile(path.join(projectDir, ".pi", "extensions", "custom.ts"), "utf8")).resolves.toContain("user");
    await expect(fs.readFile(path.join(projectDir, "harness.yaml"), "utf8")).resolves.toContain("version");

    const claudeMd = await fs.readFile(path.join(projectDir, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("user claude note");
    expect(claudeMd).not.toContain("oh-my-harness:start");

    const settings = JSON.parse(await fs.readFile(path.join(projectDir, ".claude", "settings.json"), "utf8"));
    expect(settings.permissions.allow).toEqual(["Bash(git push)"]);
    expect(JSON.stringify(settings.hooks)).toContain("node custom-claude-hook.js");
    expect(JSON.stringify(settings.hooks)).not.toContain(".omh/hooks");
    expect(settings._ohMyHarness).toBeUndefined();

    const codexHooks = JSON.parse(await fs.readFile(path.join(projectDir, ".codex", "hooks.json"), "utf8"));
    expect(JSON.stringify(codexHooks)).toContain("python3 user-codex-hook.py");
    expect(JSON.stringify(codexHooks)).not.toContain(".omh/hooks");

    const codexConfig = await fs.readFile(path.join(projectDir, ".codex", "config.toml"), "utf8");
    expect(codexConfig).toContain("inline-user-hook.py");
    expect(codexConfig).toContain("[mcp_servers.foo]");
    expect(codexConfig).not.toContain("hooks = true");
    expect(codexConfig).not.toContain("goals = true");
  });

  it("purges harness.yaml when requested", async () => {
    await prepareSyncedProject();

    const result = await uninstallCommand({ projectDir, yes: true, purge: true, skipBackupWarning: true });

    expect(result.exitCode).toBe(0);
    await expect(exists(path.join(projectDir, "harness.yaml"))).resolves.toBe(false);
  });
});

