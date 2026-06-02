import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { HarnessConfigSchema } from "../../src/core/harness-schema.js";
import { harnessToMergedConfigV2 } from "../../src/core/harness-converter-v2.js";
import { generate } from "../../src/core/generator.js";
import { computeDrift } from "../../src/core/drift.js";
import { OMH_VERSION } from "../../src/utils/version.js";

let projectDir: string;

const HARNESS = `version: "1.0"
hooks:
  - block: command-guard
    params:
      patterns:
        - "FOO"
`;

const HARNESS_CHANGED = `version: "1.0"
hooks:
  - block: command-guard
    params:
      patterns:
        - "FOO"
        - "BAR"
`;

// Write harness.yaml and run a real generate() so the project is "in sync".
async function syncProject(harnessYaml: string): Promise<void> {
  await writeFile(join(projectDir, "harness.yaml"), harnessYaml, "utf-8");
  const parsed = HarnessConfigSchema.parse(yaml.load(harnessYaml));
  const config = await harnessToMergedConfigV2(parsed, undefined, projectDir);
  await generate({ projectDir, config });
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "omh-drift-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("computeDrift", () => {
  it("reports inSync with no changes right after a sync", async () => {
    await syncProject(HARNESS);
    const drift = await computeDrift(projectDir);
    expect(drift.inSync).toBe(true);
    expect(drift.changed).toHaveLength(0);
    expect(drift.wouldDelete).toHaveLength(0);
  });

  it("detects drift when harness.yaml changes but files are not regenerated", async () => {
    await syncProject(HARNESS);
    // Edit harness.yaml only (simulate forgot-to-sync)
    await writeFile(join(projectDir, "harness.yaml"), HARNESS_CHANGED, "utf-8");
    const drift = await computeDrift(projectDir);
    expect(drift.inSync).toBe(false);
    // The new pattern changes the generated command-guard hook script.
    expect(drift.changed.some((c) => c.path.endsWith("catalog-command-guard.sh"))).toBe(true);
  });

  it("detects drift when a generated file is hand-edited", async () => {
    await syncProject(HARNESS);
    const settingsPath = join(projectDir, ".claude", "settings.json");
    await writeFile(settingsPath, '{"corrupted":true}\n', "utf-8");
    const drift = await computeDrift(projectDir);
    expect(drift.inSync).toBe(false);
    expect(drift.changed.some((c) => c.path === settingsPath)).toBe(true);
  });

  it("reports wouldDelete for hooks removed from harness.yaml", async () => {
    await syncProject(HARNESS_CHANGED);
    // Switch to a harness with no hooks → the command-guard script becomes stale.
    await writeFile(join(projectDir, "harness.yaml"), 'version: "1.0"\nhooks: []\n', "utf-8");
    const drift = await computeDrift(projectDir);
    expect(drift.inSync).toBe(false);
    expect(drift.wouldDelete.some((p) => p.endsWith("catalog-command-guard.sh"))).toBe(true);
  });

  it("stamps the omh version into the hook manifest", async () => {
    await syncProject(HARNESS);
    const manifest = JSON.parse(await readFile(join(projectDir, ".omh", "manifest.json"), "utf-8"));
    expect(manifest.omhVersion).toBe(OMH_VERSION);
  });

  it("flags version drift when the manifest was written by a different version", async () => {
    await syncProject(HARNESS);
    const manifestPath = join(projectDir, ".omh", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    manifest.omhVersion = "0.0.0-old";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    const drift = await computeDrift(projectDir);
    expect(drift.versionDrift).toEqual({ manifestVersion: "0.0.0-old", currentVersion: OMH_VERSION });
  });
});
