import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateHooks } from "../../src/generators/hooks.js";
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
    expect(content).toBe("#!/bin/bash\nexit 0");
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
    expect(content).toBe("#!/bin/bash\nexit 0");
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
});
