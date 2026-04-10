import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
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

function runScript(scriptPath: string, stdin: string): string {
  try {
    return execSync(`bash "${scriptPath}"`, {
      input: stdin,
      cwd: tmpDir,
      encoding: "utf-8",
      timeout: 5000,
    });
  } catch (e) {
    return (e as { stdout?: string }).stdout ?? "";
  }
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

    // No block JSON in output
    const trimmed = stdout.trim();
    if (trimmed.length > 0) {
      // If there is output it must NOT be a block decision
      const result = JSON.parse(trimmed);
      expect(result.decision).not.toBe("block");
    } else {
      // Empty output means the script exited cleanly without blocking
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
});
