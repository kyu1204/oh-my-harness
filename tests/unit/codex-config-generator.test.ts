import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parse } from "smol-toml";
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
  it("creates a fresh config.toml with [features] codex_hooks=true", () => {
    const result = buildCodexConfigToml("");
    const parsed = parse(result) as { features?: { codex_hooks?: unknown } };
    expect(parsed.features?.codex_hooks).toBe(true);
    expect(result).toMatch(/^# Managed by oh-my-harness/);
  });

  it("preserves user tables and keys when adding [features] codex_hooks", () => {
    const existing = `[mcp_servers.foo]
command = "bar"
args = ["--flag"]
`;
    const result = buildCodexConfigToml(existing);
    const parsed = parse(result) as {
      features?: { codex_hooks?: unknown };
      mcp_servers?: { foo?: { command?: unknown; args?: unknown } };
    };
    expect(parsed.features?.codex_hooks).toBe(true);
    expect(parsed.mcp_servers?.foo?.command).toBe("bar");
    expect(parsed.mcp_servers?.foo?.args).toEqual(["--flag"]);
  });

  it("is idempotent — running twice produces identical output", () => {
    const first = buildCodexConfigToml("");
    const second = buildCodexConfigToml(first);
    expect(second).toBe(first);
  });

  it("does NOT duplicate [features] when user already has one", () => {
    const existing = `[features]
some_other_flag = true

[mcp_servers.foo]
command = "bar"
`;
    const result = buildCodexConfigToml(existing);
    const parsed = parse(result) as {
      features?: { codex_hooks?: unknown; some_other_flag?: unknown };
      mcp_servers?: { foo?: { command?: unknown } };
    };
    // Single [features] table containing both keys
    expect(parsed.features?.codex_hooks).toBe(true);
    expect(parsed.features?.some_other_flag).toBe(true);
    // User's other tables preserved
    expect(parsed.mcp_servers?.foo?.command).toBe("bar");
  });

  it("does NOT duplicate codex_hooks when user already set it without our markers", () => {
    const existing = `[features]
codex_hooks = true
some_other_flag = true
`;
    const result = buildCodexConfigToml(existing);
    const parsed = parse(result) as {
      features?: { codex_hooks?: unknown; some_other_flag?: unknown };
    };
    expect(parsed.features?.codex_hooks).toBe(true);
    expect(parsed.features?.some_other_flag).toBe(true);
    // Only one TOML-level assignment of the key (parser would have rejected
    // the file if there were two, but verify the rendered output too).
    const codexAssignments = result.match(/^[ \t]*codex_hooks\s*=/gm) ?? [];
    expect(codexAssignments).toHaveLength(1);
  });

  it("upgrades existing codex_hooks=false to true", () => {
    const existing = `[features]
codex_hooks = false
`;
    const result = buildCodexConfigToml(existing);
    const parsed = parse(result) as { features?: { codex_hooks?: unknown } };
    expect(parsed.features?.codex_hooks).toBe(true);
    expect(result).not.toContain("codex_hooks = false");
  });

  it("handles [[array-table]] and other table forms without corrupting them", () => {
    const existing = `[features]
some_other_flag = true

[[mcp_servers]]
name = "first"

[[mcp_servers]]
name = "second"
`;
    const result = buildCodexConfigToml(existing);
    const parsed = parse(result) as {
      features?: { codex_hooks?: unknown };
      mcp_servers?: Array<{ name?: unknown }>;
    };
    expect(parsed.features?.codex_hooks).toBe(true);
    expect(parsed.mcp_servers).toHaveLength(2);
    expect(parsed.mcp_servers?.[0].name).toBe("first");
    expect(parsed.mcp_servers?.[1].name).toBe("second");
  });

  it("handles inline comments on existing keys without breaking parse", () => {
    const existing = `[features]
codex_hooks = false # legacy
some_other_flag = true # keep this
`;
    const result = buildCodexConfigToml(existing);
    const parsed = parse(result) as {
      features?: { codex_hooks?: unknown; some_other_flag?: unknown };
    };
    expect(parsed.features?.codex_hooks).toBe(true);
    expect(parsed.features?.some_other_flag).toBe(true);
  });

  it("falls back to a clean config when existing TOML is malformed", () => {
    const existing = "this is [not valid TOML";
    const result = buildCodexConfigToml(existing);
    const parsed = parse(result) as { features?: { codex_hooks?: unknown } };
    expect(parsed.features?.codex_hooks).toBe(true);
  });

  it("does NOT throw when existing `features` is a scalar boolean", () => {
    // Edge case: user wrote `features = true` at top level (valid TOML).
    // Earlier code tried to assign codex_hooks onto a boolean → TypeError.
    const existing = `features = true\n`;
    expect(() => buildCodexConfigToml(existing)).not.toThrow();
    const result = buildCodexConfigToml(existing);
    const parsed = parse(result) as { features?: { codex_hooks?: unknown } };
    expect(parsed.features?.codex_hooks).toBe(true);
  });

  it("overwrites a non-table `features` value (array) with a proper table", () => {
    const existing = `features = [1, 2, 3]\n`;
    const result = buildCodexConfigToml(existing);
    const parsed = parse(result) as { features?: { codex_hooks?: unknown } };
    expect(parsed.features?.codex_hooks).toBe(true);
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
    const parsed = parse(toml) as { features?: { codex_hooks?: unknown } };
    expect(parsed.features?.codex_hooks).toBe(true);
  });

  it("preserves existing config.toml structure outside [features]", async () => {
    const codexDir = path.join(tmpDir, ".codex");
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(
      path.join(codexDir, "config.toml"),
      `[mcp_servers.foo]\ncommand = "bar"\n`,
      "utf8",
    );

    await generateCodexConfig({ projectDir: tmpDir, hooksOutput: { hooksConfig: {}, generatedFiles: [] } });

    const toml = await fs.readFile(path.join(codexDir, "config.toml"), "utf8");
    const parsed = parse(toml) as {
      features?: { codex_hooks?: unknown };
      mcp_servers?: { foo?: { command?: unknown } };
    };
    expect(parsed.mcp_servers?.foo?.command).toBe("bar");
    expect(parsed.features?.codex_hooks).toBe(true);
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
