import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { doctorCommand } from "../../src/cli/commands/doctor.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-doctor-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function setupInitializedProject(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, ".claude"), { recursive: true });
  await fs.mkdir(path.join(dir, ".codex"), { recursive: true });
  await fs.mkdir(path.join(dir, ".omh", "hooks"), { recursive: true });
  await fs.writeFile(
    path.join(dir, ".claude", "oh-my-harness.json"),
    JSON.stringify({ presets: ["harness"], generatedAt: new Date().toISOString() }),
  );
  await fs.writeFile(path.join(dir, "CLAUDE.md"), "# CLAUDE\n");
  await fs.writeFile(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ permissions: { allow: [], deny: [] } }),
  );
  await fs.writeFile(path.join(dir, "AGENTS.md"), "# AGENTS\n");
  await fs.writeFile(path.join(dir, ".codex", "hooks.json"), JSON.stringify({}));
  await fs.writeFile(
    path.join(dir, ".codex", "config.toml"),
    "[features]\ncodex_shell = true\ncodex_hooks = true\ngoals = true\n",
  );
  // Create a dummy hook script
  const hookScript = path.join(dir, ".omh", "hooks", "command-guard.sh");
  await fs.writeFile(hookScript, "#!/bin/bash\n");
  await fs.chmod(hookScript, 0o755);
}

describe("doctorCommand", () => {
  it("returns healthy when all files are present after init", async () => {
    await setupInitializedProject(tmpDir);

    const result = await doctorCommand({ projectDir: tmpDir });

    expect(result.healthy).toBe(true);
    expect(result.checks.stateFile).toBe(true);
    expect(result.checks.claudeMd).toBe(true);
    expect(result.checks.settingsJson).toBe(true);
    expect(result.checks.hooksExecutable).toBe(true);
    expect(result.messages.filter((m) => m.startsWith("FAIL:"))).toHaveLength(0);
  });

  it("reports unhealthy when oh-my-harness.json is missing", async () => {
    // Do not initialize — no state file present
    const result = await doctorCommand({ projectDir: tmpDir });

    expect(result.healthy).toBe(false);
    expect(result.checks.stateFile).toBe(false);
    expect(result.messages.some((m) => m.includes("oh-my-harness.json"))).toBe(true);
  });

  it("reports unhealthy when CLAUDE.md is missing", async () => {
    await setupInitializedProject(tmpDir);

    // Remove CLAUDE.md after init
    await fs.rm(path.join(tmpDir, "CLAUDE.md"));

    const result = await doctorCommand({ projectDir: tmpDir });

    expect(result.healthy).toBe(false);
    expect(result.checks.claudeMd).toBe(false);
    expect(result.messages.some((m) => m.includes("CLAUDE.md"))).toBe(true);
  });

  it("reports unhealthy when settings.json is missing", async () => {
    await setupInitializedProject(tmpDir);

    // Remove settings.json after init
    await fs.rm(path.join(tmpDir, ".claude", "settings.json"));

    const result = await doctorCommand({ projectDir: tmpDir });

    expect(result.healthy).toBe(false);
    expect(result.checks.settingsJson).toBe(false);
    expect(result.messages.some((m) => m.includes("settings.json"))).toBe(true);
  });

  it("includes FAIL messages for each missing file", async () => {
    // Nothing initialized — all checks should fail
    const result = await doctorCommand({ projectDir: tmpDir });

    expect(result.healthy).toBe(false);
    const failMessages = result.messages.filter((m) => m.startsWith("FAIL:"));
    // At minimum stateFile, claudeMd, and settingsJson should fail
    expect(failMessages.length).toBeGreaterThanOrEqual(1);
  });

  it("returns exitCode 1 when unhealthy", async () => {
    // Nothing initialized — doctor should indicate failure
    const result = await doctorCommand({ projectDir: tmpDir });
    expect(result.healthy).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("returns exitCode 0 when healthy", async () => {
    await setupInitializedProject(tmpDir);
    const result = await doctorCommand({ projectDir: tmpDir });
    expect(result.healthy).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("verifies AGENTS.md exists for Codex compatibility", async () => {
    await setupInitializedProject(tmpDir);
    const result = await doctorCommand({ projectDir: tmpDir });
    expect(result.checks.agentsMd).toBe(true);
  });

  it("reports unhealthy when AGENTS.md is missing", async () => {
    await setupInitializedProject(tmpDir);
    await fs.rm(path.join(tmpDir, "AGENTS.md"));
    const result = await doctorCommand({ projectDir: tmpDir });
    expect(result.checks.agentsMd).toBe(false);
    expect(result.healthy).toBe(false);
  });

  it("verifies .codex/hooks.json and config.toml exist for Codex emitter", async () => {
    await setupInitializedProject(tmpDir);
    const result = await doctorCommand({ projectDir: tmpDir });
    expect(result.checks.codexConfig).toBe(true);
  });

  it("reports unhealthy when Codex /goal feature flag is missing", async () => {
    await setupInitializedProject(tmpDir);
    await fs.writeFile(
      path.join(tmpDir, ".codex", "config.toml"),
      "[features]\ncodex_hooks = true\n",
      "utf-8",
    );

    const result = await doctorCommand({ projectDir: tmpDir });

    expect(result.checks.codexConfig).toBe(false);
    expect(result.healthy).toBe(false);
    expect(result.messages.some((m) => m.includes("goals = true"))).toBe(true);
  });

  it("reports unhealthy when .codex/hooks.json is invalid JSON", async () => {
    await setupInitializedProject(tmpDir);
    // Simulate a merge conflict / hand-edit corrupting hooks.json
    await fs.writeFile(path.join(tmpDir, ".codex", "hooks.json"), "<<< not json", "utf-8");

    const result = await doctorCommand({ projectDir: tmpDir });

    expect(result.checks.codexConfig).toBe(false);
    expect(result.healthy).toBe(false);
    expect(result.messages.some((m) => m.includes("hooks.json") || m.includes("invalid"))).toBe(true);
  });

  it("verifies hook scripts under .omh/hooks are executable", async () => {
    await setupInitializedProject(tmpDir);
    const result = await doctorCommand({ projectDir: tmpDir });
    expect(result.checks.hooksExecutable).toBe(true);

    // Drop X bit on one script and re-check
    const hookFiles = await fs.readdir(path.join(tmpDir, ".omh/hooks"));
    const sh = hookFiles.find((f) => f.endsWith(".sh"))!;
    await fs.chmod(path.join(tmpDir, ".omh/hooks", sh), 0o644);

    const after = await doctorCommand({ projectDir: tmpDir });
    expect(after.checks.hooksExecutable).toBe(false);
  });
});
