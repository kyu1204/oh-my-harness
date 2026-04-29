import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "../../src/core/generator.js";
import type { MergedConfig } from "../../src/core/preset-types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "omh-integ-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("generate() pipeline", () => {
  it("generates CLAUDE.md with rule content from MergedConfig", async () => {
    const config: MergedConfig = {
      presets: ["test-preset"],
      variables: {},
      claudeMdSections: [
        {
          id: "test-rules",
          title: "Test Rules",
          content: "Always write tests first",
          priority: 10,
        },
      ],
      hooks: { preToolUse: [], postToolUse: [] },
      settings: { permissions: { allow: [], deny: [] } },
    };

    const result = await generate({ projectDir: tmpDir, config });

    const claudeMd = await readFile(join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("Always write tests first");
    expect(result.files).toContain(join(tmpDir, "CLAUDE.md"));
  });

  it("generates hook scripts with correct permissions when hooks are in config", async () => {
    const config: MergedConfig = {
      presets: ["test-preset"],
      variables: {},
      claudeMdSections: [],
      hooks: {
        preToolUse: [
          {
            id: "cmd-guard",
            matcher: "Bash",
            inline: "#!/bin/bash\nset -euo pipefail\nINPUT=$(cat)\nexit 0",
          },
        ],
        postToolUse: [],
      },
      settings: { permissions: { allow: [], deny: [] } },
    };

    const result = await generate({ projectDir: tmpDir, config });

    const scriptPath = join(tmpDir, ".omh/hooks/cmd-guard.sh");
    const scriptStat = await stat(scriptPath);
    // Check executable bit (owner execute = 0o100)
    expect(scriptStat.mode & 0o111).toBeGreaterThan(0);
    expect(result.files).toContain(scriptPath);
  });

  it("generates settings.json with permissions from MergedConfig", async () => {
    const config: MergedConfig = {
      presets: ["test-preset"],
      variables: {},
      claudeMdSections: [],
      hooks: { preToolUse: [], postToolUse: [] },
      settings: {
        permissions: {
          allow: ["Bash(npm test*)"],
          deny: ["Bash(rm -rf /)"],
        },
      },
    };

    const result = await generate({ projectDir: tmpDir, config });

    const settingsPath = join(tmpDir, ".claude/settings.json");
    const raw = await readFile(settingsPath, "utf-8");
    const settings = JSON.parse(raw);
    expect(settings.permissions.allow).toContain("Bash(npm test*)");
    expect(settings.permissions.deny).toContain("Bash(rm -rf /)");
    expect(result.files).toContain(settingsPath);
  });

  it("is idempotent: running generate() twice does not duplicate CLAUDE.md sections", async () => {
    const config: MergedConfig = {
      presets: ["test-preset"],
      variables: {},
      claudeMdSections: [
        {
          id: "idempotent-section",
          title: "Idempotent Section",
          content: "This content should appear once",
          priority: 10,
        },
      ],
      hooks: { preToolUse: [], postToolUse: [] },
      settings: { permissions: { allow: [], deny: [] } },
    };

    await generate({ projectDir: tmpDir, config });
    await generate({ projectDir: tmpDir, config });

    const claudeMd = await readFile(join(tmpDir, "CLAUDE.md"), "utf-8");
    const occurrences = (claudeMd.match(/This content should appear once/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("adds .omh/state/ to .gitignore when hooks are present", async () => {
    const config: MergedConfig = {
      presets: ["test-preset"],
      variables: {},
      claudeMdSections: [],
      hooks: {
        preToolUse: [
          {
            id: "guard",
            matcher: "Bash",
            inline: "#!/bin/bash\nINPUT=$(cat)\nexit 0",
          },
        ],
        postToolUse: [],
      },
      settings: { permissions: { allow: [], deny: [] } },
    };

    await generate({ projectDir: tmpDir, config });

    const gitignore = await readFile(join(tmpDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".omh/state/");
  });
});
