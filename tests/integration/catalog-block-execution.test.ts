import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { renderTemplate } from "../../src/catalog/template-engine.js";
import { wrapWithLogger } from "../../src/generators/hooks.js";
import { commandGuard } from "../../src/catalog/blocks/command-guard.js";
import { branchGuard } from "../../src/catalog/blocks/branch-guard.js";
import { commitTestGate } from "../../src/catalog/blocks/commit-test-gate.js";
import { pathGuard } from "../../src/catalog/blocks/path-guard.js";

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
});
