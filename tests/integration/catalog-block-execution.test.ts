import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { renderTemplate } from "../../src/catalog/template-engine.js";
import { wrapWithLogger } from "../../src/generators/hooks.js";
import { commandGuard } from "../../src/catalog/blocks/command-guard.js";
import { branchGuard } from "../../src/catalog/blocks/branch-guard.js";
import { commitTestGate } from "../../src/catalog/blocks/commit-test-gate.js";
import { pathGuard } from "../../src/catalog/blocks/path-guard.js";
import { lockfileGuard } from "../../src/catalog/blocks/lockfile-guard.js";
import { secretFileGuard } from "../../src/catalog/blocks/secret-file-guard.js";
import { harnessGuard } from "../../src/catalog/blocks/harness-guard.js";
import { noVerifyGuard } from "../../src/catalog/blocks/no-verify-guard.js";
import { forcePushGuard } from "../../src/catalog/blocks/force-push-guard.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "omh-integ-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function hasJq(): boolean {
  try {
    execSync("jq --version", { encoding: "utf-8", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function runScript(scriptPath: string, stdin: string, env?: NodeJS.ProcessEnv): string {
  try {
    return execSync(`/bin/bash "${scriptPath}"`, {
      input: stdin,
      cwd: tmpDir,
      encoding: "utf-8",
      timeout: 5000,
      env: env ?? process.env,
    });
  } catch (e) {
    return (e as { stdout?: string }).stdout ?? "";
  }
}

async function makeBrokenPythonPath(): Promise<string> {
  const binDir = join(tmpDir, "bin-no-python");
  await mkdir(binDir, { recursive: true });
  const pythonPath = join(binDir, "python3");
  await writeFile(pythonPath, "#!/bin/bash\nexit 127\n", { mode: 0o755 });
  await chmod(pythonPath, 0o755);
  return `${binDir}:${process.env.PATH ?? ""}`;
}

describe("catalog block execution", () => {
  it("command-guard: blocks a matched dangerous command", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }

    const rendered = renderTemplate(commandGuard.template, {
      patterns: ["rm -rf /", "sudo rm"],
    });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "command-guard.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    const stdout = runScript(
      scriptPath,
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm -rf /" } }),
    );

    const result = JSON.parse(stdout.trim());
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("rm -rf /");
  });

  it("command-guard: blocks a matched dangerous command with tab-normalized whitespace", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }

    const rendered = renderTemplate(commandGuard.template, {
      patterns: ["rm -rf /", "sudo rm"],
    });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "command-guard-tab.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    const stdout = runScript(
      scriptPath,
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm\t-rf /" } }),
    );

    const result = JSON.parse(stdout.trim());
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("rm -rf /");
  });

  it("command-guard: ignores the pattern when it only appears inside quoted text (#109)", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }

    const rendered = renderTemplate(commandGuard.template, {
      patterns: ["rm -rf /", "sudo rm"],
    });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "command-guard-quoted.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    for (const command of [
      `gh issue create --body "never run rm -rf / in CI"`,
      `echo 'sudo rm is bad'`,
      "rm -rf /tmp/build-cache",
      "rm -rf ./dist",
    ]) {
      const stdout = runScript(
        scriptPath,
        JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
      );
      expect(stdout.trim(), command).toBe("");
    }
  });

  it("command-guard: still blocks the pattern when it is a real command in a list or substitution (#109)", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }

    const rendered = renderTemplate(commandGuard.template, {
      patterns: ["rm -rf /", "sudo rm"],
    });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "command-guard-real.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    for (const command of [
      "cd /tmp && rm -rf /",
      'rm -rf "/"',
      "echo $(sudo rm -rf /var/lib/x)",
      "sudo rm -rf /var/lib/x",
    ]) {
      const stdout = runScript(
        scriptPath,
        JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
      );
      expect(JSON.parse(stdout.trim()).decision, command).toBe("block");
    }
  });

  it("commit-test-gate: does not run the test command when 'git commit' only appears in a heredoc or string (#109)", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }

    // testCommand leaves a marker file; the gate must not run it.
    const marker = join(tmpDir, "ran-tests");
    const rendered = renderTemplate(commitTestGate.template, {
      testCommand: `touch '${marker}'`,
    });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "commit-test-gate-heredoc.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    const command = `gh pr create --body "$(cat <<'EOF'
Run git commit after tests pass.
EOF
)"`;
    const stdout = runScript(
      scriptPath,
      JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    );
    expect(stdout.trim()).toBe("");
    expect(existsSync(marker)).toBe(false);

    // ...and it does run for a real commit, including git -c options.
    runScript(
      scriptPath,
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "git -c user.name=x commit -m wip" } }),
    );
    expect(existsSync(marker)).toBe(true);
  });

  it("command-guard: allows a safe command (exit 0, no block output)", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }

    const rendered = renderTemplate(commandGuard.template, {
      patterns: ["rm -rf /", "sudo rm"],
    });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "command-guard-allow.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    const stdout = runScript(
      scriptPath,
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "npm test" } }),
    );

    const trimmed = stdout.trim();
    if (trimmed.length > 0) {
      const result = JSON.parse(trimmed);
      expect(result.decision).not.toBe("block");
    } else {
      expect(trimmed).toBe("");
    }
  });

  it("harness-guard: blocks shell writes to the harness's own files (#113)", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }
    const rendered = renderTemplate(harnessGuard.template, { extraPaths: ["ops/protected.yml"] });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "harness-guard.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    for (const command of [
      "sed -i 's/block/allow/' .omh/hooks/catalog-tdd-guard.sh",
      "sed -ni 's/block/allow/p' .omh/hooks/catalog-tdd-guard.sh",
      "sed --in-place=.bak 's/a/b/' .codex/config.toml",
      "rm -rf .omh",
      "rm .omh/state/tdd-edits.json",
      "chmod -x ./.omh/hooks/catalog-command-guard.sh",
      "echo '{}' > .claude/settings.json",
      "cat /dev/null >> .codex/hooks.json",
      "git checkout -- .claude/settings.json",
      "git -C . restore .pi/extensions/omh-harness.ts",
      "mv .codex/config.toml /tmp/x",
      "cp /tmp/evil.sh /abs/path/project/.omh/hooks/catalog-tdd-guard.sh",
      "cd src && rm -rf ../.omh/hooks",
      "sudo rm -rf .omh",
      "bash -c 'rm -rf .omh'",
      "find .omh -name '*.sh' -delete",
      "tee ops/protected.yml < /dev/null",
    ]) {
      const stdout = runScript(scriptPath, JSON.stringify({ tool_name: "Bash", tool_input: { command } }));
      const result = JSON.parse(stdout.trim());
      expect(result.decision, command).toBe("block");
      expect(result.reason, command).toContain("omh sync");
    }
  });

  it("harness-guard: allows reads, unrelated writes, omh itself and mentions in strings", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }
    const rendered = renderTemplate(harnessGuard.template, { extraPaths: [] });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "harness-guard-allow.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    for (const command of [
      "cat .omh/hooks/catalog-tdd-guard.sh",
      "sed -n '/BLOCKED/,/^}/p' .omh/hooks/catalog-tdd-guard.sh",   // read-only sed (QA)
      "sed 's/a/b/' .claude/settings.json",
      "grep -n block .claude/settings.json",
      "ls -la .omh/hooks",
      "diff .codex/hooks.json /tmp/other.json",
      "omh sync",
      "npx oh-my-harness hook add tdd-guard",
      "rm -rf dist node_modules",
      "echo x > .omh-notes.md",
      "sed -i 's/a/b/' src/omh/index.ts",
      "git checkout -b feat/x",
      "git commit -m 'touch .omh/hooks in the message'",
      "echo 'rm -rf .omh'",
      "find src -name '*.ts' -delete",
    ]) {
      const stdout = runScript(scriptPath, JSON.stringify({ tool_name: "Bash", tool_input: { command } }));
      expect(stdout.trim(), command).toBe("");
    }
  });

  it("harness-guard: leaves Codex apply_patch to path-guard", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }
    const rendered = renderTemplate(harnessGuard.template, { extraPaths: [] });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "harness-guard-patch.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });
    const stdout = runScript(
      scriptPath,
      JSON.stringify({ tool_name: "apply_patch", tool_input: { command: "*** Update File: .omh/hooks/x.sh\nrm -rf .omh" } }),
    );
    expect(stdout.trim()).toBe("");
  });

  it("no-verify-guard: blocks hook bypasses on commit and push (#98)", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }
    const wrapped = wrapWithLogger(renderTemplate(noVerifyGuard.template, {}), "PreToolUse");
    const scriptPath = join(tmpDir, "no-verify-guard.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    for (const command of [
      "git commit -m x --no-verify",
      "git commit --no-verify -m x",
      "git commit -n -m x",
      "git commit -anm x",
      "git commit -qn",
      "git push --no-verify origin feat/x",
      "git -c core.hooksPath=/dev/null commit -m x",
      "sudo git commit --no-verify -m x",
      "cd sub && git commit -n -m y",
      "bash -c 'git commit --no-verify -m z'",
      "git -c core.hookspath=/dev/null commit -m x",                                   // config keys are case-insensitive
      "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x",
      "GIT_CONFIG_PARAMETERS='core.hooksPath=/dev/null' git commit -m x",
      "/usr/bin/git commit --no-verify -m x",                                          // executable path is normalised
    ]) {
      const stdout = runScript(scriptPath, JSON.stringify({ tool_name: "Bash", tool_input: { command } }));
      const result = JSON.parse(stdout.trim());
      expect(result.decision, command).toBe("block");
    }
    for (const command of [
      "git commit -m x",
      "git commit -am 'never use --no-verify'",
      "git commit -m n",
      "git commit --amend --no-edit",
      "git push -n origin feat/x",
      "git push origin feat/x",
      "echo git commit --no-verify",
      "npm test -- -n",
    ]) {
      const stdout = runScript(scriptPath, JSON.stringify({ tool_name: "Bash", tool_input: { command } }));
      expect(stdout.trim(), command).toBe("");
    }
  });

  it("force-push-guard: blocks force pushes to protected branches only (#99)", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }
    const render = async (params: Record<string, unknown>, name: string) => {
      const p = join(tmpDir, name);
      await writeFile(p, wrapWithLogger(renderTemplate(forcePushGuard.template, params), "PreToolUse"), { mode: 0o755 });
      return p;
    };
    const s = await render({ protected: ["main", "master"], allowLease: true }, "force-push-guard.sh");

    for (const command of [
      "git push --force origin main",
      "git push -f origin master",
      "git push origin +main",
      "git push --force origin HEAD:main",
      "git push --force origin feature:refs/heads/main",
      "git push origin main --force",
      "sudo git push -f origin main",
      "cd sub && git push --force origin main",
      "git push --force origin feature:feature main:main",   // every refspec is checked
      "git push --force origin feature main",
      "git push origin feature +main",
      "/usr/bin/git push -f origin main",
      "git push --force",   // no refspec and not inside a git repo: fail closed
    ]) {
      const stdout = runScript(s, JSON.stringify({ tool_name: "Bash", tool_input: { command } }));
      const result = JSON.parse(stdout.trim());
      expect(result.decision, command).toBe("block");
    }
    for (const command of [
      "git push origin main",
      "git push --force origin feat/x",
      "git push -f origin HEAD:feat/x",
      "git push --force-with-lease origin main",
      "git push --force-with-lease=main:abc origin main",
      "git push --force-if-includes --force-with-lease origin main",
      "git push --force-if-includes origin main",   // no-op without --force-with-lease
      "echo 'git push --force origin main'",
      "git push --tags origin",
    ]) {
      const stdout = runScript(s, JSON.stringify({ tool_name: "Bash", tool_input: { command } }));
      expect(stdout.trim(), command).toBe("");
    }

    const strict = await render({ protected: ["main", "release"], allowLease: false }, "force-push-guard-strict.sh");
    expect(JSON.parse(runScript(strict, JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push --force-with-lease origin main" } })).trim()).decision).toBe("block");
    expect(JSON.parse(runScript(strict, JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push -f origin release" } })).trim()).decision).toBe("block");
    expect(runScript(strict, JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push -f origin master" } })).trim()).toBe("");
  });

  it("force-push-guard: resolves the real push target when no refspec is given (push.default=upstream)", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }
    // feature tracks origin/main with push.default=upstream: a bare
    // `git push --force` rewrites remote main even though HEAD is "feature".
    const bare = join(tmpDir, "remote.git");
    execSync(`git init -q --bare "${bare}"`, { cwd: tmpDir });
    execSync(
      [
        "git init -q",
        "git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init",
        "git branch -M main",
        `git remote add origin "${bare}"`,
        "git push -q origin main",
        "git checkout -q -b feature",
        "git branch --set-upstream-to=origin/main feature",
        "git config push.default upstream",
      ].join(" && "),
      { cwd: tmpDir },
    );
    const s = join(tmpDir, "force-push-guard-upstream.sh");
    await writeFile(s, wrapWithLogger(renderTemplate(forcePushGuard.template, { protected: ["main"], allowLease: true }), "PreToolUse"), { mode: 0o755 });

    const blocked = runScript(s, JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push --force" } }));
    expect(JSON.parse(blocked.trim()).decision).toBe("block");
    expect(JSON.parse(blocked.trim()).reason).toContain("main");

    // same repo, explicit non-protected refspec: allowed
    const allowed = runScript(s, JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push --force origin feature" } }));
    expect(allowed.trim()).toBe("");
  });

  it("branch-guard: rendered script contains git commit detection logic", async () => {
    const rendered = renderTemplate(branchGuard.template, { mainBranch: "main" });
    expect(rendered).toContain("git commit");
    expect(rendered).toContain("git push");
    expect(rendered).toContain("main");
  });

  it("commit-test-gate: rendered script contains the configured testCommand", async () => {
    const testCommand = "npx vitest run";
    const rendered = renderTemplate(commitTestGate.template, { testCommand });
    expect(rendered).toContain(testCommand);
    expect(rendered).toContain("git commit");
  });

  it("path-guard: blocks a write to a blocked path", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }

    const rendered = renderTemplate(pathGuard.template, {
      blockedPaths: ["dist/", "node_modules/"],
    });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "path-guard.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    const stdout = runScript(
      scriptPath,
      JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: "dist/bundle.js" },
      }),
    );

    const result = JSON.parse(stdout.trim());
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("dist/");
  });

  it("path-guard: blocks edits to the harness's own hook files and runtime wiring by default", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }

    const rendered = renderTemplate(pathGuard.template, {
      blockedPaths: ["dist/"],
      protectHarness: true,
    });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "path-guard-harness.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    for (const file_path of [
      ".omh/hooks/catalog-tdd-guard.sh",
      ".claude/settings.json",
      ".codex/hooks.json",
      ".codex/config.toml",
      ".pi/extensions/omh-harness.ts",
      "sub/project/.omh/hooks/x.sh",
    ]) {
      const stdout = runScript(
        scriptPath,
        JSON.stringify({ tool_name: "Write", tool_input: { file_path } }),
      );
      const result = JSON.parse(stdout.trim());
      expect(result.decision, file_path).toBe("block");
    }
  });

  it("path-guard: protectHarness=false leaves harness files editable", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }

    const rendered = renderTemplate(pathGuard.template, {
      blockedPaths: ["dist/"],
      protectHarness: false,
    });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "path-guard-harness-off.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    const stdout = runScript(
      scriptPath,
      JSON.stringify({ tool_name: "Write", tool_input: { file_path: ".claude/settings.json" } }),
    );
    expect(stdout.trim()).toBe("");
  });

  it("path-guard: allows a write to a non-blocked path", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }

    const rendered = renderTemplate(pathGuard.template, {
      blockedPaths: ["dist/", "node_modules/"],
    });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "path-guard-allow.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    const stdout = runScript(
      scriptPath,
      JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: "src/index.ts" },
      }),
    );

    const trimmed = stdout.trim();
    if (trimmed.length > 0) {
      const result = JSON.parse(trimmed);
      expect(result.decision).not.toBe("block");
    } else {
      expect(trimmed).toBe("");
    }
  });

  it("path-guard: generated script normalizes path before comparison to prevent traversal bypass", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }

    const rendered = renderTemplate(pathGuard.template, {
      blockedPaths: ["dist/"],
    });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "path-guard-normalize.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    const stdout = runScript(
      scriptPath,
      JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: "./foo/../dist/secret.js" },
      }),
    );

    const result = JSON.parse(stdout.trim());
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("dist/");
  });

  it("path-guard: blocks non-canonical paths when python3 normalization fails", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }

    const rendered = renderTemplate(pathGuard.template, {
      blockedPaths: ["src/generated/"],
    });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "path-guard-no-python.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    const stdout = runScript(
      scriptPath,
      JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: "src/foo/../generated/file.ts" },
      }),
      { ...process.env, PATH: await makeBrokenPythonPath() },
    );

    const result = JSON.parse(stdout.trim());
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("path normalization unavailable");
  });

  // -------------------------------------------------------------------------
  // Codex apply_patch payload: tool_input.command holds the patch text and
  // file paths are encoded in "*** {Add|Update|Delete} File: <path>" headers.
  // Guards must extract those paths instead of bailing on missing file_path.
  // -------------------------------------------------------------------------

  it("path-guard: blocks apply_patch when a patch header references a blocked directory", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }
    const rendered = renderTemplate(pathGuard.template, { blockedPaths: ["dist/"] });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "path-guard-apply-patch-block.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    const patch =
      "*** Begin Patch\n*** Update File: dist/bundle.js\n@@\n-x\n+y\n*** End Patch\n";
    const stdout = runScript(
      scriptPath,
      JSON.stringify({ tool_name: "apply_patch", tool_input: { command: patch } }),
    );

    const result = JSON.parse(stdout.trim());
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("dist/");
  });

  it("path-guard: allows apply_patch when no header references a blocked path", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }
    const rendered = renderTemplate(pathGuard.template, { blockedPaths: ["dist/"] });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "path-guard-apply-patch-allow.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    const patch =
      "*** Begin Patch\n*** Update File: src/index.ts\n@@\n-a\n+b\n*** End Patch\n";
    const stdout = runScript(
      scriptPath,
      JSON.stringify({ tool_name: "apply_patch", tool_input: { command: patch } }),
    );
    expect(stdout.trim()).toBe("");
  });

  it("path-guard: blocks apply_patch when one of multiple headers references a blocked path", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }
    const rendered = renderTemplate(pathGuard.template, { blockedPaths: ["dist/"] });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "path-guard-apply-patch-multi.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    const patch = [
      "*** Begin Patch",
      "*** Update File: src/safe.ts",
      "@@",
      "-a",
      "+b",
      "*** Update File: dist/bundle.js",
      "@@",
      "-x",
      "+y",
      "*** End Patch",
      "",
    ].join("\n");
    const stdout = runScript(
      scriptPath,
      JSON.stringify({ tool_name: "apply_patch", tool_input: { command: patch } }),
    );

    const result = JSON.parse(stdout.trim());
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("dist/");
  });

  it("lockfile-guard: blocks apply_patch that updates a protected lockfile", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }
    const rendered = renderTemplate(lockfileGuard.template, {
      lockfiles: ["package-lock.json", "yarn.lock"],
    });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "lockfile-guard-apply-patch.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    const patch =
      "*** Begin Patch\n*** Update File: package-lock.json\n@@\n-}\n+}\n*** End Patch\n";
    const stdout = runScript(
      scriptPath,
      JSON.stringify({ tool_name: "apply_patch", tool_input: { command: patch } }),
    );

    const result = JSON.parse(stdout.trim());
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("package-lock.json");
  });

  it("secret-file-guard: blocks apply_patch that adds a .env file", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }
    const rendered = renderTemplate(secretFileGuard.template, {
      patterns: [".env", "*.pem"],
    });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "secret-file-guard-apply-patch.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    const patch = "*** Begin Patch\n*** Add File: .env\n+API_KEY=hi\n*** End Patch\n";
    const stdout = runScript(
      scriptPath,
      JSON.stringify({ tool_name: "apply_patch", tool_input: { command: patch } }),
    );

    const result = JSON.parse(stdout.trim());
    expect(result.decision).toBe("block");
    expect(result.reason).toContain(".env");
  });

  // -------------------------------------------------------------------------
  // CRLF-encoded apply_patch payloads. sed's `$` matches before `\n` only, so
  // a CRLF patch would otherwise leave a trailing `\r` on every extracted
  // path and silently bypass every file-targeted guard. Each guard must strip
  // the carriage return before comparison.
  // -------------------------------------------------------------------------

  it("path-guard: blocks apply_patch when the patch uses CRLF line endings", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }
    const rendered = renderTemplate(pathGuard.template, { blockedPaths: ["dist/"] });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "path-guard-apply-patch-crlf.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    const patch =
      "*** Begin Patch\r\n*** Update File: dist/bundle.js\r\n@@\r\n-x\r\n+y\r\n*** End Patch\r\n";
    const stdout = runScript(
      scriptPath,
      JSON.stringify({ tool_name: "apply_patch", tool_input: { command: patch } }),
    );

    const result = JSON.parse(stdout.trim());
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("dist/");
  });

  it("lockfile-guard: blocks apply_patch with CRLF line endings against package-lock.json", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }
    const rendered = renderTemplate(lockfileGuard.template, {
      lockfiles: ["package-lock.json", "yarn.lock"],
    });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "lockfile-guard-apply-patch-crlf.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    const patch =
      "*** Begin Patch\r\n*** Update File: package-lock.json\r\n@@\r\n-}\r\n+}\r\n*** End Patch\r\n";
    const stdout = runScript(
      scriptPath,
      JSON.stringify({ tool_name: "apply_patch", tool_input: { command: patch } }),
    );

    const result = JSON.parse(stdout.trim());
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("package-lock.json");
    // Belt-and-suspenders: the reason must not contain a literal CR — that
    // would indicate the trailing \r leaked through to basename().
    expect(result.reason).not.toContain("\r");
  });

  it("secret-file-guard: blocks apply_patch with CRLF line endings against .env", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }
    const rendered = renderTemplate(secretFileGuard.template, {
      patterns: [".env", "*.pem"],
    });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "secret-file-guard-apply-patch-crlf.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    const patch =
      "*** Begin Patch\r\n*** Add File: .env\r\n+API_KEY=hi\r\n*** End Patch\r\n";
    const stdout = runScript(
      scriptPath,
      JSON.stringify({ tool_name: "apply_patch", tool_input: { command: patch } }),
    );

    const result = JSON.parse(stdout.trim());
    expect(result.decision).toBe("block");
    expect(result.reason).toContain(".env");
    expect(result.reason).not.toContain("\r");
  });
});
