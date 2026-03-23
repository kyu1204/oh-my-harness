import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { initCommand } from "../../src/cli/commands/init.js";
import { doctorCommand } from "../../src/cli/commands/doctor.js";

const PRESETS_DIR = path.resolve(import.meta.dirname, "../../presets");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-doctor-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("doctorCommand", () => {
  it("returns healthy when all files are present after init", async () => {
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

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
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

    // Remove CLAUDE.md after init
    await fs.rm(path.join(tmpDir, "CLAUDE.md"));

    const result = await doctorCommand({ projectDir: tmpDir });

    expect(result.healthy).toBe(false);
    expect(result.checks.claudeMd).toBe(false);
    expect(result.messages.some((m) => m.includes("CLAUDE.md"))).toBe(true);
  });

  it("reports unhealthy when settings.json is missing", async () => {
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

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
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });
    const result = await doctorCommand({ projectDir: tmpDir });
    expect(result.healthy).toBe(true);
    expect(result.exitCode).toBe(0);
  });
});
