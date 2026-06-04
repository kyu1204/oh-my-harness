import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, access, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyUninstallPlan,
  computeUninstall,
  stripClaudeSettings,
  stripCodexConfigToml,
  stripGitignoreSection,
  stripManagedMarkdown,
} from "../../src/core/uninstall.js";

let projectDir: string;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "omh-uninstall-core-"));
});

afterEach(async () => {
  await chmod(projectDir, 0o755).catch(() => undefined);
  await rm(projectDir, { recursive: true, force: true });
});

describe("uninstall strip helpers", () => {
  it("removes all managed markdown sections and preserves user text", () => {
    const result = stripManagedMarkdown(
      [
        "user intro",
        "<!-- oh-my-harness:start:a -->",
        "managed",
        "<!-- oh-my-harness:end:a -->",
        "user outro",
      ].join("\n"),
    );

    expect(result).toContain("user intro");
    expect(result).toContain("user outro");
    expect(result).not.toContain("oh-my-harness:start");
  });

  it("strips Claude managed permissions/hooks/meta but keeps user content", async () => {
    const hooksDir = join(projectDir, ".omh", "hooks");
    await mkdir(hooksDir, { recursive: true });
    const omhHook = join(hooksDir, "guard.sh");
    await writeFile(omhHook, "#!/usr/bin/env bash\n", "utf8");

    const result = await stripClaudeSettings(
      {
        userCustomKey: "keep",
        permissions: {
          allow: ["Bash(git push)", "Bash(pnpm test*)"],
          deny: ["Bash(rm -rf /)"],
        },
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                { type: "command", command: "node custom-hook.js" },
                { type: "command", command: `bash '${omhHook}'` },
              ],
            },
          ],
        },
        _ohMyHarness: {
          managedPermissions: {
            allow: ["Bash(pnpm test*)"],
            deny: ["Bash(rm -rf /)"],
          },
        },
      },
      projectDir,
    );

    expect(result).toMatchObject({
      userCustomKey: "keep",
      permissions: { allow: ["Bash(git push)"] },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node custom-hook.js" }] }],
      },
    });
    expect(result).not.toHaveProperty("_ohMyHarness");
  });

  it("removes OMH feature flags from Codex config while warning about user-owned ambiguity", () => {
    const stripped = stripCodexConfigToml(
      [
        "[features]",
        "hooks = true",
        "goals = true",
        "some_other_flag = true",
        "",
        "[mcp_servers.foo]",
        'command = "bar"',
      ].join("\n"),
    );

    expect(stripped.content).toContain("some_other_flag = true");
    expect(stripped.content).toContain("[mcp_servers.foo]");
    expect(stripped.content).not.toContain("hooks = true");
    expect(stripped.content).not.toContain("goals = true");
    expect(stripped.warnings.join("\n")).toContain("[features].hooks/goals");
    expect(stripped.warnings.join("\n")).toContain("comments");
  });

  it("removes the oh-my-harness gitignore section only", () => {
    const result = stripGitignoreSection(["node_modules/", "", "# oh-my-harness", ".omh/state/", "", "dist/"].join("\n"));
    expect(result).toBe(["node_modules/", "", "dist/", ""].join("\n"));
  });
});

describe("computeUninstall and applyUninstallPlan", () => {
  it("plans and applies safe removal while preserving user-owned files", async () => {
    await mkdir(join(projectDir, ".omh", "hooks"), { recursive: true });
    await mkdir(join(projectDir, ".claude"), { recursive: true });
    await mkdir(join(projectDir, ".codex"), { recursive: true });
    await mkdir(join(projectDir, ".pi", "extensions"), { recursive: true });
    await writeFile(join(projectDir, ".omh", "hooks", "guard.sh"), "#!/usr/bin/env bash\n", "utf8");
    await writeFile(join(projectDir, ".claude", "oh-my-harness.json"), "{}\n", "utf8");
    await writeFile(join(projectDir, ".pi", "extensions", "omh-harness.ts"), "generated\n", "utf8");
    await writeFile(join(projectDir, ".pi", "extensions", "custom.ts"), "user\n", "utf8");
    await writeFile(join(projectDir, "harness.yaml"), "presets: []\n", "utf8");
    await writeFile(
      join(projectDir, "CLAUDE.md"),
      "hello\n<!-- oh-my-harness:start:x -->\nmanaged\n<!-- oh-my-harness:end:x -->\n",
      "utf8",
    );

    const plan = await computeUninstall({ projectDir });
    expect(plan.delete).toContain(join(projectDir, ".omh"));
    expect(plan.delete).toContain(join(projectDir, ".claude", "oh-my-harness.json"));
    expect(plan.delete).toContain(join(projectDir, ".pi", "extensions", "omh-harness.ts"));
    expect(plan.keptHarnessYaml).toBe(true);
    expect(plan.destructiveWarnings.join("\n")).toContain("백업 후 실행 권장");

    const result = await applyUninstallPlan(plan);
    expect(result.failed).toEqual([]);
    await expect(readFile(join(projectDir, "CLAUDE.md"), "utf8")).resolves.toBe("hello\n");
    await expect(readFile(join(projectDir, ".pi", "extensions", "custom.ts"), "utf8")).resolves.toBe("user\n");
    await expect(exists(join(projectDir, ".omh"))).resolves.toBe(false);
    await expect(exists(join(projectDir, "harness.yaml"))).resolves.toBe(true);
  });

  it("purges harness.yaml only when requested", async () => {
    await writeFile(join(projectDir, "harness.yaml"), "presets: []\n", "utf8");
    const plan = await computeUninstall({ projectDir, purge: true });
    expect(plan.delete).toContain(join(projectDir, "harness.yaml"));
  });

  it("restores modified files on stop-on-error failure", async () => {
    const keep = join(projectDir, "CLAUDE.md");
    await writeFile(keep, "original\n", "utf8");
    const plan = {
      delete: [join(projectDir, "does-not-exist", "file")],
      modify: [{ path: keep, content: "changed\n" }],
      removeDirs: [],
      keptHarnessYaml: false,
      warnings: [],
      destructiveWarnings: [],
    };

    const result = await applyUninstallPlan(plan);

    expect(result.failed[0]?.op).toBe("delete");
    await expect(readFile(keep, "utf8")).resolves.toBe("original\n");
    expect(result.restored).toContain(keep);
  });
});

