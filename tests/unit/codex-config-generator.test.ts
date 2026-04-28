import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  generateCodexConfig,
  buildCodexHooks,
  buildCodexConfigToml,
} from "../../src/generators/codex-config.js";
import type { HooksOutput } from "../../src/generators/hooks.js";

function makeHooksOutput(overrides: Partial<HooksOutput["hooksConfig"]> = {}): HooksOutput {
  return {
    hooksConfig: { ...overrides },
    generatedFiles: [],
  };
}

describe("buildCodexHooks", () => {
  it("passes Codex-supported events through unchanged", () => {
    const out = makeHooksOutput({
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "bash /p/.omh/hooks/x.sh" }] },
      ],
      PostToolUse: [
        { matcher: "", hooks: [{ type: "command", command: "bash /p/.omh/hooks/y.sh" }] },
      ],
      SessionStart: [
        { matcher: "startup", hooks: [{ type: "command", command: "bash /p/.omh/hooks/z.sh" }] },
      ],
    });

    const { codexHooks, skipped } = buildCodexHooks(out);

    expect(skipped).toEqual([]);
    expect(codexHooks.hooks.PreToolUse).toEqual(out.hooksConfig.PreToolUse);
    expect(codexHooks.hooks.PostToolUse).toEqual(out.hooksConfig.PostToolUse);
    expect(codexHooks.hooks.SessionStart).toEqual(out.hooksConfig.SessionStart);
  });

  it("drops Codex-unsupported events with skipped report", () => {
    const out = makeHooksOutput({
      Notification: [{ matcher: "", hooks: [{ type: "command", command: "bash /p/notify.sh" }] }],
      ConfigChange: [{ matcher: "", hooks: [{ type: "command", command: "bash /p/audit.sh" }] }],
      WorktreeCreate: [{ matcher: "", hooks: [{ type: "command", command: "bash /p/wt.sh" }] }],
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "bash /p/g.sh" }] }],
    });

    const { codexHooks, skipped } = buildCodexHooks(out);

    expect(codexHooks.hooks).toHaveProperty("PreToolUse");
    expect(codexHooks.hooks).not.toHaveProperty("Notification");
    expect(codexHooks.hooks).not.toHaveProperty("ConfigChange");
    expect(codexHooks.hooks).not.toHaveProperty("WorktreeCreate");
    expect(skipped.sort()).toEqual(["ConfigChange", "Notification", "WorktreeCreate"].sort());
  });

  it("normalizes Edit|Write matcher to also include apply_patch (Codex alias)", () => {
    const out = makeHooksOutput({
      PreToolUse: [
        { matcher: "Edit|Write", hooks: [{ type: "command", command: "bash /p/g.sh" }] },
      ],
    });

    const { codexHooks } = buildCodexHooks(out);

    expect(codexHooks.hooks.PreToolUse[0].matcher).toBe("Edit|Write|apply_patch");
  });

  it("leaves unrelated matchers alone", () => {
    const out = makeHooksOutput({
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "bash /p/g.sh" }] }],
    });

    const { codexHooks } = buildCodexHooks(out);
    expect(codexHooks.hooks.PreToolUse[0].matcher).toBe("Bash");
  });
});

describe("buildCodexConfigToml", () => {
  it("creates a fresh config.toml with [features] codex_hooks=true block", () => {
    const result = buildCodexConfigToml("");
    expect(result).toContain("# >>> oh-my-harness >>>");
    expect(result).toContain("[features]");
    expect(result).toContain("codex_hooks = true");
    expect(result).toContain("# <<< oh-my-harness <<<");
  });

  it("upserts the managed block in an existing config.toml without losing user content", () => {
    const existing = `# user comment
[mcp_servers.foo]
command = "bar"
`;
    const result = buildCodexConfigToml(existing);
    expect(result).toContain("# user comment");
    expect(result).toContain("[mcp_servers.foo]");
    expect(result).toContain("codex_hooks = true");
  });

  it("replaces a previous managed block on re-run (idempotent)", () => {
    const first = buildCodexConfigToml("");
    const second = buildCodexConfigToml(first);
    // Should still contain exactly one managed block
    const matches = second.match(/# >>> oh-my-harness >>>/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("does NOT duplicate [features] when user already has one (TOML v1.0 violation)", () => {
    // User wrote their own [features] table with another key
    const existing = `# my settings
[features]
some_other_flag = true

[mcp_servers.foo]
command = "bar"
`;
    const result = buildCodexConfigToml(existing);

    // Must contain exactly one [features] header
    const featuresHeaders = result.match(/^\[features\]\s*$/gm) ?? [];
    expect(featuresHeaders).toHaveLength(1);

    // Must preserve user's key
    expect(result).toContain("some_other_flag = true");
    // Must add our key
    expect(result).toContain("codex_hooks = true");
    // Must preserve other tables
    expect(result).toContain("[mcp_servers.foo]");
  });

  it("injecting into an existing [features] table is idempotent", () => {
    const existing = `[features]
some_other_flag = true
`;
    const first = buildCodexConfigToml(existing);
    const second = buildCodexConfigToml(first);
    const third = buildCodexConfigToml(second);

    expect(third).toBe(second);
    const featuresHeaders = third.match(/^\[features\]\s*$/gm) ?? [];
    expect(featuresHeaders).toHaveLength(1);
    expect(third).toContain("some_other_flag = true");
    expect(third).toContain("codex_hooks = true");
  });
});

describe("generateCodexConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-codex-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes .codex/hooks.json and .codex/config.toml", async () => {
    const hooksOutput: HooksOutput = {
      hooksConfig: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: `bash "${tmpDir}/.omh/hooks/g.sh"` }] },
        ],
      },
      generatedFiles: [],
    };

    const files = await generateCodexConfig({ projectDir: tmpDir, hooksOutput });

    expect(files).toEqual([
      path.join(tmpDir, ".codex/hooks.json"),
      path.join(tmpDir, ".codex/config.toml"),
    ]);

    const hooksJson = JSON.parse(await fs.readFile(path.join(tmpDir, ".codex/hooks.json"), "utf8"));
    expect(hooksJson.hooks.PreToolUse).toHaveLength(1);
    expect(hooksJson.hooks.PreToolUse[0].matcher).toBe("Bash");

    const toml = await fs.readFile(path.join(tmpDir, ".codex/config.toml"), "utf8");
    expect(toml).toContain("codex_hooks = true");
  });

  it("preserves existing config.toml content outside managed block", async () => {
    const codexDir = path.join(tmpDir, ".codex");
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(
      path.join(codexDir, "config.toml"),
      `[mcp_servers.foo]\ncommand = "bar"\n`,
      "utf8",
    );

    await generateCodexConfig({ projectDir: tmpDir, hooksOutput: { hooksConfig: {}, generatedFiles: [] } });

    const toml = await fs.readFile(path.join(codexDir, "config.toml"), "utf8");
    expect(toml).toContain("[mcp_servers.foo]");
    expect(toml).toContain("codex_hooks = true");
  });

  it("emits empty hooks.json when no hooks present", async () => {
    const files = await generateCodexConfig({
      projectDir: tmpDir,
      hooksOutput: { hooksConfig: {}, generatedFiles: [] },
    });

    expect(files).toHaveLength(2);
    const hooksJson = JSON.parse(await fs.readFile(path.join(tmpDir, ".codex/hooks.json"), "utf8"));
    expect(hooksJson).toEqual({ hooks: {} });
  });
});
