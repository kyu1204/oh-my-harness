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

describe("harness.yaml → hooks end-to-end", () => {
  it("parses harness.yaml, converts to MergedConfig, and generates hook script files", async () => {
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
    const config = harnessToMergedConfig(harness);
    const output = await generateHooks({ projectDir: tmpDir, config });

    expect(output.generatedFiles.length).toBeGreaterThan(0);
    const scriptPath = output.generatedFiles[0];
    const scriptContent = await readFile(scriptPath, "utf-8");
    expect(scriptContent).toBeTruthy();
  });

  it("renders blockedCommands into command-guard script content", async () => {
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
    const config = harnessToMergedConfig(harness);
    const output = await generateHooks({ projectDir: tmpDir, config });

    const guardFile = output.generatedFiles.find((f) => f.includes("harness-command-guard"));
    expect(guardFile).toBeDefined();
    const content = await readFile(guardFile!, "utf-8");
    expect(content).toContain("rm -rf");
    expect(content).toContain("sudo");
  });

  it("generates script containing preCommit commands", async () => {
    const rawConfig = {
      ...minimalHarnessYaml,
      enforcement: {
        preCommit: ["npm run lint", "npm test"],
        blockedPaths: [],
        blockedCommands: [],
        postSave: [],
      },
    };

    const harness = HarnessConfigSchema.parse(rawConfig);
    const config = harnessToMergedConfig(harness);

    expect(config.hooks.preToolUse).toHaveLength(1);
    expect(config.hooks.preToolUse[0].id).toBe("harness-pre-commit");

    const output = await generateHooks({ projectDir: tmpDir, config });
    const scriptFile = output.generatedFiles.find((f) => f.includes("harness-pre-commit"));
    expect(scriptFile).toBeDefined();

    const content = await readFile(scriptFile!, "utf-8");
    expect(content).toContain("npm run lint");
    expect(content).toContain("npm test");
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
    const config = harnessToMergedConfig(harness);
    const output = await generateHooks({ projectDir: tmpDir, config });

    const scriptFile = output.generatedFiles.find((f) => f.includes("harness-pre-commit"));
    expect(scriptFile).toBeDefined();

    const content = await readFile(scriptFile!, "utf-8");
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
    const config = harnessToMergedConfig(harness);
    const output = await generateHooks({ projectDir: tmpDir, config });

    const scriptFile = output.generatedFiles.find((f) => f.includes("harness-pre-commit"));
    expect(scriptFile).toBeDefined();

    const content = await readFile(scriptFile!, "utf-8");
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
    const config = harnessToMergedConfig(harness);
    const output = await generateHooks({ projectDir: tmpDir, config });

    const postSaveFile = output.generatedFiles.find((f) => f.includes("harness-post-save"));
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
    const config = harnessToMergedConfig(harness);
    const output = await generateHooks({ projectDir: tmpDir, config });

    for (const scriptFile of output.generatedFiles) {
      const fileStat = await stat(scriptFile);
      expect(fileStat.mode & 0o111).toBeGreaterThan(0);
    }
  });

  it("harnessToMergedConfigV2 returns same base config when no catalog hooks are present", async () => {
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
    const v2 = await harnessToMergedConfigV2(harness);

    expect(v2.hooks.preToolUse).toHaveLength(v1.hooks.preToolUse.length);
    expect(v2.claudeMdSections).toEqual(v1.claudeMdSections);
    expect(v2.settings.permissions.allow).toEqual(v1.settings.permissions.allow);
  });

  it("hooksConfig output contains PreToolUse entry with matcher from hook definition", async () => {
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
    const config = harnessToMergedConfig(harness);
    const output = await generateHooks({ projectDir: tmpDir, config });

    expect(output.hooksConfig["PreToolUse"]).toBeDefined();
    const entry = output.hooksConfig["PreToolUse"].find((e) => e.matcher === "Bash");
    expect(entry).toBeDefined();
    expect(entry!.hooks[0].command).toContain("harness-command-guard.sh");
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
