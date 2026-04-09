import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateHooks, wrapWithLogger } from "../../src/generators/hooks.js";
import type { MergedConfig } from "../../src/core/preset-types.js";

function makeMergedConfig(overrides: Partial<MergedConfig> = {}): MergedConfig {
  return {
    presets: [],
    variables: {},
    claudeMdSections: [],
    hooks: {
      preToolUse: [],
      postToolUse: [],
    },
    settings: {
      permissions: { allow: [], deny: [] },
    },
    ...overrides,
  };
}

describe("generateHooks", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "oh-my-harness-test-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("handles empty hooks gracefully", async () => {
    const config = makeMergedConfig();
    const result = await generateHooks({ projectDir, config });

    expect(result.hooksConfig).toEqual({});
    expect(result.generatedFiles).toEqual([]);
  });

  it("generates hook scripts from inline content", async () => {
    const config = makeMergedConfig({
      hooks: {
        preToolUse: [
          { id: "command-guard", matcher: "Bash", inline: "#!/bin/bash\nexit 0" },
        ],
        postToolUse: [],
      },
    });

    const result = await generateHooks({ projectDir, config });

    expect(result.generatedFiles).toHaveLength(1);
    const scriptPath = join(projectDir, ".claude/hooks/command-guard.sh");
    const content = await readFile(scriptPath, "utf8");
    expect(content).toContain("#!/bin/bash");
    expect(content).toContain("exit 0");
  });

  it("sets executable permissions on generated scripts", async () => {
    const config = makeMergedConfig({
      hooks: {
        preToolUse: [
          { id: "command-guard", matcher: "Bash", inline: "#!/bin/bash\nexit 0" },
        ],
        postToolUse: [],
      },
    });

    await generateHooks({ projectDir, config });

    const scriptPath = join(projectDir, ".claude/hooks/command-guard.sh");
    const fileStat = await stat(scriptPath);
    // Check owner execute bit (0o100)
    expect(fileStat.mode & 0o111).toBeGreaterThan(0);
  });

  it("creates hooks config matching Claude Code settings format", async () => {
    const config = makeMergedConfig({
      hooks: {
        preToolUse: [
          { id: "command-guard", matcher: "Bash", inline: "#!/bin/bash\nexit 0" },
        ],
        postToolUse: [
          { id: "lint-on-save", matcher: "Edit|Write", inline: "#!/bin/bash\nexit 0" },
        ],
      },
    });

    const result = await generateHooks({ projectDir, config });

    expect(result.hooksConfig).toHaveProperty("PreToolUse");
    expect(result.hooksConfig).toHaveProperty("PostToolUse");

    expect(result.hooksConfig["PreToolUse"]).toEqual([
      { matcher: "Bash", hooks: [{ type: "command", command: "bash .claude/hooks/command-guard.sh" }] },
    ]);
    expect(result.hooksConfig["PostToolUse"]).toEqual([
      { matcher: "Edit|Write", hooks: [{ type: "command", command: "bash .claude/hooks/lint-on-save.sh" }] },
    ]);
  });

  it("writes an empty manifest after removing all previously generated hooks", async () => {
    await generateHooks({
      projectDir,
      config: makeMergedConfig({
        hooks: {
          preToolUse: [{ id: "command-guard", matcher: "Bash", inline: "#!/bin/bash\nexit 0" }],
          postToolUse: [],
        },
      }),
    });

    const result = await generateHooks({ projectDir, config: makeMergedConfig() });
    const manifestPath = join(projectDir, ".claude/hooks/oh-my-harness-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    expect(result).toEqual({ hooksConfig: {}, generatedFiles: [] });
    expect(manifest.hooks).toEqual([]);
  });

  it("throws when an existing hooks manifest cannot be parsed", async () => {
    const hooksDir = join(projectDir, ".claude/hooks");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(hooksDir, { recursive: true });
    await writeFile(join(hooksDir, "oh-my-harness-manifest.json"), "{not-json", "utf8");

    await expect(generateHooks({ projectDir, config: makeMergedConfig() })).rejects.toThrow();
  });

  it("writes manifest file tracking generated hooks", async () => {
    const config = makeMergedConfig({
      hooks: {
        preToolUse: [
          { id: "command-guard", matcher: "Bash", inline: "#!/bin/bash\nexit 0" },
        ],
        postToolUse: [
          { id: "lint-on-save", matcher: "Edit|Write", inline: "#!/bin/bash\nexit 0" },
        ],
      },
    });

    await generateHooks({ projectDir, config });

    const manifestPath = join(projectDir, ".claude/hooks/oh-my-harness-manifest.json");
    const manifestContent = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestContent);

    expect(manifest).toHaveProperty("generatedAt");
    expect(manifest.hooks).toContain("command-guard.sh");
    expect(manifest.hooks).toContain("lint-on-save.sh");
  });

  it("groups hooks by matcher correctly", async () => {
    const config = makeMergedConfig({
      hooks: {
        preToolUse: [
          { id: "guard-bash", matcher: "Bash", inline: "#!/bin/bash\nexit 0" },
          { id: "guard-edit", matcher: "Edit|Write", inline: "#!/bin/bash\nexit 0" },
        ],
        postToolUse: [],
      },
    });

    const result = await generateHooks({ projectDir, config });

    expect(result.hooksConfig["PreToolUse"]).toHaveLength(2);
    expect(result.hooksConfig["PreToolUse"]).toEqual([
      { matcher: "Bash", hooks: [{ type: "command", command: "bash .claude/hooks/guard-bash.sh" }] },
      { matcher: "Edit|Write", hooks: [{ type: "command", command: "bash .claude/hooks/guard-edit.sh" }] },
    ]);
  });

  it("sanitizes hook.id with path traversal characters", async () => {
    const config = makeMergedConfig({
      hooks: {
        preToolUse: [
          { id: "../../etc/passwd", matcher: "Bash", inline: "#!/bin/bash\nexit 0" },
        ],
        postToolUse: [],
      },
    });

    const result = await generateHooks({ projectDir, config });

    // Sanitized id: only alphanumeric, hyphens, underscores remain
    const safeId = "etcpasswd";
    const scriptPath = join(projectDir, `.claude/hooks/${safeId}.sh`);
    expect(result.generatedFiles).toContain(scriptPath);
    expect(result.hooksConfig["PreToolUse"]).toEqual([
      { matcher: "Bash", hooks: [{ type: "command", command: `bash .claude/hooks/${safeId}.sh` }] },
    ]);
    // Ensure no file was written outside the hooks dir
    const content = await readFile(scriptPath, "utf8");
    expect(content).toContain("#!/bin/bash");
    expect(content).toContain("exit 0");
  });

  it("does not register hooks without inline content in hooksConfig", async () => {
    const config = makeMergedConfig({
      hooks: {
        preToolUse: [
          { id: "no-inline-hook", matcher: "Bash" } as never,
        ],
        postToolUse: [],
      },
    });

    const result = await generateHooks({ projectDir, config });

    expect(result.hooksConfig).toEqual({});
    expect(result.generatedFiles).toEqual([]);
  });

  it("returns generated file paths in generatedFiles", async () => {
    const config = makeMergedConfig({
      hooks: {
        preToolUse: [
          { id: "command-guard", matcher: "Bash", inline: "#!/bin/bash\nexit 0" },
        ],
        postToolUse: [
          { id: "lint-on-save", matcher: "Edit|Write", inline: "#!/bin/bash\nexit 0" },
        ],
      },
    });

    const result = await generateHooks({ projectDir, config });

    expect(result.generatedFiles).toHaveLength(2);
    expect(result.generatedFiles).toContain(
      join(projectDir, ".claude/hooks/command-guard.sh")
    );
    expect(result.generatedFiles).toContain(
      join(projectDir, ".claude/hooks/lint-on-save.sh")
    );
  });

  it("generated scripts contain logger snippet", async () => {
    const config = makeMergedConfig({
      hooks: {
        preToolUse: [
          { id: "command-guard", matcher: "Bash", inline: "#!/bin/bash\nset -euo pipefail\nINPUT=$(cat)\nexit 0" },
        ],
        postToolUse: [],
      },
    });

    await generateHooks({ projectDir, config });

    const scriptPath = join(projectDir, ".claude/hooks/command-guard.sh");
    const content = await readFile(scriptPath, "utf8");
    expect(content).toContain("_OMH_STATE_DIR");
    expect(content).toContain("_log_event");
    expect(content).toContain("_log_event");
    expect(content).toContain("EXIT");
  });
});

describe("wrapWithLogger", () => {
  it("inserts logger after INPUT=$(cat)", () => {
    const script = "#!/bin/bash\nset -euo pipefail\nINPUT=$(cat)\nexit 0";
    const result = wrapWithLogger(script);
    const inputIdx = result.indexOf("INPUT=$(cat)");
    const loggerIdx = result.indexOf("_OMH_STATE_DIR");
    expect(loggerIdx).toBeGreaterThan(inputIdx);
  });

  it("inserts logger after set -euo pipefail when no INPUT=$(cat)", () => {
    const script = "#!/bin/bash\nset -euo pipefail\nexit 0";
    const result = wrapWithLogger(script);
    const pipeIdx = result.indexOf("set -euo pipefail");
    const loggerIdx = result.indexOf("_OMH_STATE_DIR");
    expect(loggerIdx).toBeGreaterThan(pipeIdx);
    expect(result).not.toContain("INPUT=$(cat)");
  });

  it("inserts logger after shebang when no INPUT=$(cat) and no set -euo pipefail", () => {
    const script = "#!/bin/bash\nexit 0";
    const result = wrapWithLogger(script);
    const shebangIdx = result.indexOf("#!/bin/bash");
    const loggerIdx = result.indexOf("_OMH_STATE_DIR");
    expect(loggerIdx).toBeGreaterThan(shebangIdx);
  });

  it("includes _log_event function in logger snippet", () => {
    const script = "#!/bin/bash\nINPUT=$(cat)\nexit 0";
    const result = wrapWithLogger(script);
    expect(result).toContain("_log_event()");
  });

  it("includes trap EXIT in logger snippet", () => {
    const script = "#!/bin/bash\nINPUT=$(cat)\nexit 0";
    const result = wrapWithLogger(script);
    expect(result).toContain("_log_event");
    expect(result).toContain("EXIT");
  });

  it("preserves original script content", () => {
    const script = "#!/bin/bash\nINPUT=$(cat)\nexit 0";
    const result = wrapWithLogger(script);
    expect(result).toContain("#!/bin/bash");
    expect(result).toContain("INPUT=$(cat)");
    expect(result).toContain("exit 0");
  });

  it("logger snippet includes event field in JSON output", () => {
    const script = "#!/bin/bash\nINPUT=$(cat)\nexit 0";
    const result = wrapWithLogger(script);
    expect(result).toContain('"event"');
  });

  it("handles #!/usr/bin/env bash shebang", () => {
    const script = "#!/usr/bin/env bash\nexit 0";
    const result = wrapWithLogger(script);
    expect(result).toContain("_OMH_STATE_DIR");
    expect(result).toContain("#!/usr/bin/env bash");
  });
});

describe("generateHooks — stale hook cleanup on sync", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "oh-my-harness-cleanup-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("removes stale hook file when hook is deleted from harness.yaml", async () => {
    // First sync: tdd-guard + branch-guard
    const configBefore = makeMergedConfig({
      hooks: {
        preToolUse: [
          { id: "tdd-guard", matcher: "Bash", inline: "#!/bin/bash\nexit 0" },
          { id: "branch-guard", matcher: "Bash", inline: "#!/bin/bash\nexit 0" },
        ],
        postToolUse: [],
      },
    });
    await generateHooks({ projectDir, config: configBefore });

    const tddScript = join(projectDir, ".claude/hooks/tdd-guard.sh");
    const branchScript = join(projectDir, ".claude/hooks/branch-guard.sh");

    // Verify both files exist
    await expect(stat(tddScript)).resolves.toBeDefined();
    await expect(stat(branchScript)).resolves.toBeDefined();

    // Second sync: tdd-guard removed
    const configAfter = makeMergedConfig({
      hooks: {
        preToolUse: [
          { id: "branch-guard", matcher: "Bash", inline: "#!/bin/bash\nexit 0" },
        ],
        postToolUse: [],
      },
    });
    await generateHooks({ projectDir, config: configAfter });

    // tdd-guard.sh must be deleted
    await expect(stat(tddScript)).rejects.toThrow();
    // branch-guard.sh must remain
    await expect(stat(branchScript)).resolves.toBeDefined();
  });

  it("removes all stale hooks when all hooks are removed", async () => {
    const configBefore = makeMergedConfig({
      hooks: {
        preToolUse: [
          { id: "tdd-guard", matcher: "Bash", inline: "#!/bin/bash\nexit 0" },
        ],
        postToolUse: [],
      },
    });
    await generateHooks({ projectDir, config: configBefore });

    const tddScript = join(projectDir, ".claude/hooks/tdd-guard.sh");
    await expect(stat(tddScript)).resolves.toBeDefined();

    // Second sync: no hooks
    const configAfter = makeMergedConfig();
    await generateHooks({ projectDir, config: configAfter });

    await expect(stat(tddScript)).rejects.toThrow();
  });

  it("does not error when there is no prior manifest", async () => {
    // First sync with no prior manifest — should work cleanly
    const config = makeMergedConfig({
      hooks: {
        preToolUse: [
          { id: "branch-guard", matcher: "Bash", inline: "#!/bin/bash\nexit 0" },
        ],
        postToolUse: [],
      },
    });
    await expect(generateHooks({ projectDir, config })).resolves.toBeDefined();
  });
});

describe("generateHooks — extended events", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "oh-my-harness-ext-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("generates scripts for SessionStart hooks", async () => {
    const config = makeMergedConfig({
      hooks: {
        preToolUse: [],
        postToolUse: [],
        sessionStart: [
          { id: "compact-context", matcher: "compact", inline: "#!/bin/bash\necho context" },
        ],
      },
    });

    const result = await generateHooks({ projectDir, config });

    expect(result.generatedFiles).toHaveLength(1);
    expect(result.hooksConfig["SessionStart"]).toHaveLength(1);
    expect(result.hooksConfig["SessionStart"][0].matcher).toBe("compact");
  });

  it("generates scripts for Notification hooks", async () => {
    const config = makeMergedConfig({
      hooks: {
        preToolUse: [],
        postToolUse: [],
        notification: [
          { id: "desktop-notify", matcher: "", inline: "#!/bin/bash\necho notify" },
        ],
      },
    });

    const result = await generateHooks({ projectDir, config });

    expect(result.generatedFiles).toHaveLength(1);
    expect(result.hooksConfig["Notification"]).toHaveLength(1);
    expect(result.hooksConfig["Notification"][0].hooks[0].command).toContain("desktop-notify.sh");
  });

  it("generates scripts for ConfigChange hooks", async () => {
    const config = makeMergedConfig({
      hooks: {
        preToolUse: [],
        postToolUse: [],
        configChange: [
          { id: "config-audit", matcher: "", inline: "#!/bin/bash\necho audit" },
        ],
      },
    });

    const result = await generateHooks({ projectDir, config });

    expect(result.generatedFiles).toHaveLength(1);
    expect(result.hooksConfig["ConfigChange"]).toHaveLength(1);
    expect(result.hooksConfig["ConfigChange"][0].hooks[0].command).toContain("config-audit.sh");
  });

  it("mixes standard and extended events in single config", async () => {
    const config = makeMergedConfig({
      hooks: {
        preToolUse: [
          { id: "branch-guard", matcher: "Bash", inline: "#!/bin/bash\necho guard" },
        ],
        postToolUse: [],
        sessionStart: [
          { id: "compact-context", matcher: "compact", inline: "#!/bin/bash\necho context" },
        ],
      },
    });

    const result = await generateHooks({ projectDir, config });

    expect(result.generatedFiles).toHaveLength(2);
    expect(result.hooksConfig["PreToolUse"]).toHaveLength(1);
    expect(result.hooksConfig["SessionStart"]).toHaveLength(1);
  });
});
