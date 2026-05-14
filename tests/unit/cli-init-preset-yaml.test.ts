import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { HarnessConfigSchema } from "../../src/core/harness-schema.js";

describe("initCommand --preset emits harness.yaml", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-init-preset-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes harness.yaml after preset-based init", async () => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "demo", scripts: { test: "vitest" } }),
      "utf-8",
    );

    const { initCommand } = await import("../../src/cli/commands/init.js");
    await initCommand([], {
      projectDir: tmpDir,
      preset: ["nextjs"],
      yes: true,
    });

    const harnessPath = path.join(tmpDir, "harness.yaml");
    const exists = await fs
      .stat(harnessPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    const raw = await fs.readFile(harnessPath, "utf-8");
    const parsed = yaml.load(raw);
    const result = HarnessConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it("emitted harness.yaml is sync-compatible (no schema errors)", async () => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "demo" }),
      "utf-8",
    );

    const { initCommand } = await import("../../src/cli/commands/init.js");
    await initCommand([], { projectDir: tmpDir, preset: ["nextjs"], yes: true });

    const { syncCommand } = await import("../../src/cli/commands/sync.js");
    let exited = false;
    const origExit = process.exit;
    process.exit = ((code?: number) => {
      if (code && code !== 0) exited = true;
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;
    try {
      await syncCommand({ projectDir: tmpDir }).catch(() => {});
    } finally {
      process.exit = origExit;
    }
    expect(exited).toBe(false);
  });
});
