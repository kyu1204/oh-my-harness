import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { initCommand } from "../../src/cli/commands/init.js";
import { addCommand } from "../../src/cli/commands/add.js";
import { removeCommand } from "../../src/cli/commands/remove.js";

const PRESETS_DIR = path.resolve(import.meta.dirname, "../../presets");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-add-remove-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("addCommand", () => {
  it("adds a new preset to oh-my-harness.json after init", async () => {
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

    const stateFile = path.join(tmpDir, ".claude", "oh-my-harness.json");
    const before = JSON.parse(await fs.readFile(stateFile, "utf-8"));
    expect(before.presets).toEqual(["_base"]);

    // Add nextjs preset on top of _base
    await addCommand("nextjs", { projectDir: tmpDir, presetsDir: PRESETS_DIR });

    const after = JSON.parse(await fs.readFile(stateFile, "utf-8"));
    expect(after.presets).toContain("_base");
    expect(after.presets).toContain("nextjs");
  });

  it("is idempotent when adding an already-active preset", async () => {
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

    await addCommand("_base", { projectDir: tmpDir, presetsDir: PRESETS_DIR });

    const stateFile = path.join(tmpDir, ".claude", "oh-my-harness.json");
    const state = JSON.parse(await fs.readFile(stateFile, "utf-8"));
    // Should not duplicate _base
    expect(state.presets.filter((p: string) => p === "_base").length).toBe(1);
  });

  it("regenerates CLAUDE.md after adding a preset", async () => {
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

    await addCommand("nextjs", { projectDir: tmpDir, presetsDir: PRESETS_DIR });

    const claudeMd = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("Next.js");
  });

  it("throws for a non-existent preset", async () => {
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

    await expect(
      addCommand("nonexistent-preset", { projectDir: tmpDir, presetsDir: PRESETS_DIR })
    ).rejects.toThrow(/Preset not found/);
  });

  it("throws when harness is not initialized", async () => {
    await expect(
      addCommand("_base", { projectDir: tmpDir, presetsDir: PRESETS_DIR })
    ).rejects.toThrow();
  });
});

describe("removeCommand", () => {
  it("removes an active preset and updates oh-my-harness.json", async () => {
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

    // First add nextjs so we have something to remove
    await addCommand("nextjs", { projectDir: tmpDir, presetsDir: PRESETS_DIR });

    const stateFile = path.join(tmpDir, ".claude", "oh-my-harness.json");
    const before = JSON.parse(await fs.readFile(stateFile, "utf-8"));
    expect(before.presets).toContain("nextjs");

    await removeCommand("nextjs", { projectDir: tmpDir, presetsDir: PRESETS_DIR });

    const after = JSON.parse(await fs.readFile(stateFile, "utf-8"));
    expect(after.presets).not.toContain("nextjs");
    expect(after.presets).toContain("_base");
  });

  it("cleans up hook files that belong only to the removed preset", async () => {
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });
    await addCommand("nextjs", { projectDir: tmpDir, presetsDir: PRESETS_DIR });

    const hooksDir = path.join(tmpDir, ".claude", "hooks");
    const filesBefore = await fs.readdir(hooksDir);
    // nextjs adds its own hook scripts on top of _base hooks
    const nextjsHooksBefore = filesBefore.filter((f) => f.startsWith("nextjs-"));
    expect(nextjsHooksBefore.length).toBeGreaterThan(0);

    await removeCommand("nextjs", { projectDir: tmpDir, presetsDir: PRESETS_DIR });

    // nextjs-specific hooks should be gone
    const filesAfter = await fs.readdir(hooksDir);
    const nextjsHooksAfter = filesAfter.filter((f) => f.startsWith("nextjs-"));
    expect(nextjsHooksAfter).toHaveLength(0);

    // _base hooks should still be present
    const baseHooks = filesAfter.filter((f) => f.startsWith("base-"));
    expect(baseHooks.length).toBeGreaterThan(0);
  });

  it("throws when trying to remove a preset that is not active", async () => {
    await initCommand(["_base"], { yes: true, projectDir: tmpDir, presetsDir: PRESETS_DIR });

    await expect(
      removeCommand("nonexistent", { projectDir: tmpDir, presetsDir: PRESETS_DIR })
    ).rejects.toThrow(/not active/);
  });

  it("throws when harness is not initialized", async () => {
    await expect(
      removeCommand("_base", { projectDir: tmpDir, presetsDir: PRESETS_DIR })
    ).rejects.toThrow();
  });
});
