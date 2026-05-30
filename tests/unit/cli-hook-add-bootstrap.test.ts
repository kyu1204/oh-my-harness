import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { HarnessConfigSchema } from "../../src/core/harness-schema.js";

describe("hookAddCommand bootstraps harness.yaml when missing", () => {
  let tmpDir: string;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-hook-add-"));
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a schema-conformant harness.yaml when one does not exist", async () => {
    const { hookAddCommand } = await import("../../src/cli/commands/hook.js");

    await hookAddCommand("tdd-guard", { projectDir: tmpDir, yes: true });

    const harnessPath = path.join(tmpDir, "harness.yaml");
    const raw = await fs.readFile(harnessPath, "utf-8");
    const parsed = yaml.load(raw);
    const result = HarnessConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
    if (result.success) {
      const tdd = result.data.hooks.find((h) => h.block === "tdd-guard");
      expect(tdd).toBeDefined();
    }
  });

  it("does not emit schema-validation errors after bootstrap", async () => {
    const { hookAddCommand } = await import("../../src/cli/commands/hook.js");
    await hookAddCommand("tdd-guard", { projectDir: tmpDir, yes: true });

    const errors = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errors).not.toContain("validation failed");
    expect(errors).not.toContain("project: Required");
    expect(errors).not.toContain("rules: Required");
  });

  it("writes the catalog-<id>.sh hook script under .omh/hooks", async () => {
    const { hookAddCommand } = await import("../../src/cli/commands/hook.js");
    await hookAddCommand("branch-guard", { projectDir: tmpDir, yes: true });

    const hookPath = path.join(tmpDir, ".omh", "hooks", "catalog-branch-guard.sh");
    const exists = await fs.stat(hookPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});
