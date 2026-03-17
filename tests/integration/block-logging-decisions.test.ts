import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { renderTemplate } from "../../src/catalog/template-engine.js";
import { wrapWithLogger } from "../../src/generators/hooks.js";
import { readEvents } from "../../src/cli/event-logger.js";
import { commandGuard } from "../../src/catalog/blocks/command-guard.js";
import { pathGuard } from "../../src/catalog/blocks/path-guard.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "omh-block-logging-"));
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

describe("block logging decisions", () => {
  it("command-guard block: writes decision=block to events.jsonl", async () => {
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

    runScript(
      scriptPath,
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm -rf /" } }),
    );

    const events = await readEvents(tmpDir);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const blockEvent = events.find((e) => e.decision === "block");
    expect(blockEvent).toBeDefined();
    expect(blockEvent!.decision).toBe("block");
    expect(blockEvent!.reason).toContain("rm -rf /");
    expect(blockEvent!.event).toBe("PreToolUse");
  });

  it("command-guard allow: writes decision=allow to events.jsonl", async () => {
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

    runScript(
      scriptPath,
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "npm test" } }),
    );

    const events = await readEvents(tmpDir);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const allowEvent = events.find((e) => e.decision === "allow");
    expect(allowEvent).toBeDefined();
    expect(allowEvent!.decision).toBe("allow");
  });

  it("command-guard block: no duplicate allow event written on block", async () => {
    if (!hasJq()) {
      console.log("jq not found, skipping");
      return;
    }

    const rendered = renderTemplate(commandGuard.template, {
      patterns: ["rm -rf /"],
    });
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    const scriptPath = join(tmpDir, "command-guard-nodup.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });

    runScript(
      scriptPath,
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm -rf /" } }),
    );

    const events = await readEvents(tmpDir);
    const allowEvents = events.filter((e) => e.decision === "allow");
    expect(allowEvents).toHaveLength(0);
    const blockEvents = events.filter((e) => e.decision === "block");
    expect(blockEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("path-guard block: writes decision=block to events.jsonl", async () => {
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

    runScript(
      scriptPath,
      JSON.stringify({ tool_name: "Write", tool_input: { file_path: "dist/bundle.js" } }),
    );

    const events = await readEvents(tmpDir);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const blockEvent = events.find((e) => e.decision === "block");
    expect(blockEvent).toBeDefined();
    expect(blockEvent!.decision).toBe("block");
    expect(blockEvent!.reason).toContain("dist/");
    expect(blockEvent!.event).toBe("PreToolUse");
  });
});
