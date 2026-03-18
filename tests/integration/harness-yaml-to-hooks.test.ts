import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessConfigSchema } from "../../src/core/harness-schema.js";
import { harnessToMergedConfig } from "../../src/core/harness-converter.js";
import { harnessToMergedConfigV2 } from "../../src/core/harness-converter-v2.js";
import { generateHooks, wrapWithLogger } from "../../src/generators/hooks.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "omh-integ-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const minimalHarnessYaml = {
  version: "1.0" as const,
  project: {
    name: "test-project",
    stacks: [{ name: "backend", framework: "express", language: "typescript" }],
  },
  rules: [],
  enforcement: {
    preCommit: [],
    blockedPaths: [],
    blockedCommands: [],
    postSave: [],
  },
  permissions: { allow: [], deny: [] },
};

describe("harness.yaml → hooks end-to-end (via v2 catalog pipeline)", () => {
  it("parses harness.yaml with enforcement.preCommit, converts via v2, and generates catalog hook scripts", async () => {
    const rawConfig = {
      ...minimalHarnessYaml,
      enforcement: {
        preCommit: ["npm test"],
        blockedPaths: [],
        blockedCommands: [],
        postSave: [],
      },
    };

    const harness = HarnessConfigSchema.parse(rawConfig);
    const config = await harnessToMergedConfigV2(harness);
    const output = await generateHooks({ projectDir: tmpDir, config });

    expect(output.generatedFiles.length).toBeGreaterThan(0);
    const scriptPath = output.generatedFiles[0];
    const scriptContent = await readFile(scriptPath, "utf-8");
    expect(scriptContent).toBeTruthy();
  });

  it("renders blockedCommands into catalog command-guard script content via v2", async () => {
    const rawConfig = {
      ...minimalHarnessYaml,
      enforcement: {
        preCommit: [],
        blockedPaths: [],
        blockedCommands: ["rm -rf", "sudo"],
        postSave: [],
      },
    };

    const harness = HarnessConfigSchema.parse(rawConfig);
    const config = await harnessToMergedConfigV2(harness);
    const output = await generateHooks({ projectDir: tmpDir, config });

    const guardFile = output.generatedFiles.find((f) => f.includes("command-guard"));
    expect(guardFile).toBeDefined();
    const content = await readFile(guardFile!, "utf-8");
    expect(content).toContain("rm -rf");
    expect(content).toContain("sudo");
  });

  it("generates catalog commit-test-gate script from enforcement.preCommit via v2", async () => {
    const rawConfig = {
      ...minimalHarnessYaml,
      enforcement: {
        preCommit: ["npm test"],
        blockedPaths: [],
        blockedCommands: [],
        postSave: [],
      },
    };

    const harness = HarnessConfigSchema.parse(rawConfig);
    const config = await harnessToMergedConfigV2(harness);

    // enforcement.preCommit is converted to catalog commit-test-gate hook
    const testGateHooks = config.hooks.preToolUse.filter((h) => h.id.includes("commit-test-gate"));
    expect(testGateHooks).toHaveLength(1);

    const output = await generateHooks({ projectDir: tmpDir, config });
    expect(output.generatedFiles.length).toBeGreaterThan(0);
  });

  it("generated script contains logger wrapper (_log_event function)", async () => {
    const rawConfig = {
      ...minimalHarnessYaml,
      enforcement: {
        preCommit: ["npm test"],
        blockedPaths: [],
        blockedCommands: [],
        postSave: [],
      },
    };

    const harness = HarnessConfigSchema.parse(rawConfig);
    const config = await harnessToMergedConfigV2(harness);
    const output = await generateHooks({ projectDir: tmpDir, config });

    expect(output.generatedFiles.length).toBeGreaterThan(0);
    const scriptFile = output.generatedFiles[0];
    const content = await readFile(scriptFile, "utf-8");
    expect(content).toContain("_log_event");
    expect(content).toContain("oh-my-harness event logger");
  });

  it("generated PreToolUse script contains correct event type in logger", async () => {
    const rawConfig = {
      ...minimalHarnessYaml,
      enforcement: {
        preCommit: ["npm test"],
        blockedPaths: [],
        blockedCommands: [],
        postSave: [],
      },
    };

    const harness = HarnessConfigSchema.parse(rawConfig);
    const config = await harnessToMergedConfigV2(harness);
    const output = await generateHooks({ projectDir: tmpDir, config });

    expect(output.generatedFiles.length).toBeGreaterThan(0);
    const content = await readFile(output.generatedFiles[0], "utf-8");
    expect(content).toContain("PreToolUse");
  });

  it("generated PostToolUse script contains PostToolUse event type in logger", async () => {
    const rawConfig = {
      ...minimalHarnessYaml,
      enforcement: {
        preCommit: [],
        blockedPaths: [],
        blockedCommands: [],
        postSave: [{ pattern: "*.ts", command: "npx eslint" }],
      },
    };

    const harness = HarnessConfigSchema.parse(rawConfig);
    const config = await harnessToMergedConfigV2(harness);
    const output = await generateHooks({ projectDir: tmpDir, config });

    // lint-on-save is a PostToolUse hook
    const postSaveFile = output.generatedFiles.find((f) => f.includes("lint-on-save"));
    expect(postSaveFile).toBeDefined();

    const content = await readFile(postSaveFile!, "utf-8");
    expect(content).toContain("PostToolUse");
  });

  it("generated script files have executable permissions", async () => {
    const rawConfig = {
      ...minimalHarnessYaml,
      enforcement: {
        preCommit: ["npm test"],
        blockedPaths: [],
        blockedCommands: [],
        postSave: [],
      },
    };

    const harness = HarnessConfigSchema.parse(rawConfig);
    const config = await harnessToMergedConfigV2(harness);
    const output = await generateHooks({ projectDir: tmpDir, config });

    for (const scriptFile of output.generatedFiles) {
      const fileStat = await stat(scriptFile);
      expect(fileStat.mode & 0o111).toBeGreaterThan(0);
    }
  });

  it("harnessToMergedConfig returns empty hooks (enforcement handled by v2 pipeline)", async () => {
    const rawConfig = {
      ...minimalHarnessYaml,
      enforcement: {
        preCommit: ["npm test"],
        blockedPaths: [],
        blockedCommands: [],
        postSave: [],
      },
    };

    const harness = HarnessConfigSchema.parse(rawConfig);
    const v1 = harnessToMergedConfig(harness);

    // v1 no longer generates inline enforcement hooks
    expect(v1.hooks.preToolUse).toHaveLength(0);
    expect(v1.hooks.postToolUse).toHaveLength(0);
  });

  it("hooksConfig output contains PreToolUse entry with matcher from catalog hook definition", async () => {
    const rawConfig = {
      ...minimalHarnessYaml,
      enforcement: {
        preCommit: [],
        blockedPaths: [],
        blockedCommands: ["rm -rf"],
        postSave: [],
      },
    };

    const harness = HarnessConfigSchema.parse(rawConfig);
    const config = await harnessToMergedConfigV2(harness);
    const output = await generateHooks({ projectDir: tmpDir, config });

    expect(output.hooksConfig["PreToolUse"]).toBeDefined();
    const entry = output.hooksConfig["PreToolUse"].find((e) => e.matcher === "Bash");
    expect(entry).toBeDefined();
    expect(entry!.hooks[0].command).toContain("command-guard.sh");
  });
});

describe("wrapWithLogger()", () => {
  it("injects logger snippet after INPUT=$(cat) when present", () => {
    const script = "#!/bin/bash\nINPUT=$(cat)\nexit 0";
    const wrapped = wrapWithLogger(script, "PreToolUse");
    const inputPos = wrapped.indexOf("INPUT=$(cat)");
    const loggerPos = wrapped.indexOf("_log_event");
    expect(loggerPos).toBeGreaterThan(inputPos);
  });

  it("injects logger snippet after set -euo pipefail when INPUT not present", () => {
    const script = "#!/bin/bash\nset -euo pipefail\nexit 0";
    const wrapped = wrapWithLogger(script, "PostToolUse");
    expect(wrapped).toContain("_log_event");
    expect(wrapped).toContain("PostToolUse");
  });

  it("injects logger after shebang when neither INPUT nor set -euo pipefail present", () => {
    const script = "#!/bin/bash\necho hello";
    const wrapped = wrapWithLogger(script, "PreToolUse");
    expect(wrapped).toContain("_log_event");
    const shebangPos = wrapped.indexOf("#!/bin/bash");
    const loggerPos = wrapped.indexOf("_log_event");
    expect(loggerPos).toBeGreaterThan(shebangPos);
  });
});
