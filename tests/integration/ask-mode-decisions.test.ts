import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { renderTemplate } from "../../src/catalog/template-engine.js";
import { wrapWithLogger } from "../../src/generators/hooks.js";
import { commandGuard } from "../../src/catalog/blocks/command-guard.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "omh-ask-mode-"));
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

// Claude PreToolUse payload includes a transcript_path field; Codex does not.
// The ask-mode hook uses this to decide whether the runtime understands a
// permissionDecision:"ask" escalation (Claude) or must hard-block (Codex).
const CLAUDE_STDIN = JSON.stringify({
  session_id: "s1",
  transcript_path: "/tmp/x.jsonl",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command: "rm -rf /" },
});

const CODEX_STDIN = JSON.stringify({
  tool_name: "Bash",
  tool_input: { command: "rm -rf /" },
});

async function buildScript(mode: "block" | "ask"): Promise<string> {
  const rendered = renderTemplate(commandGuard.template, { patterns: ["rm -rf /"] });
  const wrapped = wrapWithLogger(rendered, "PreToolUse", undefined, mode);
  const scriptPath = join(tmpDir, `command-guard-${mode}.sh`);
  await writeFile(scriptPath, wrapped, { mode: 0o755 });
  return scriptPath;
}

describe("ask-mode decisions (runtime-detecting single script)", () => {
  it("ask mode + Claude payload: emits permissionDecision=ask (no hard block)", async () => {
    if (!hasJq()) return;
    const scriptPath = await buildScript("ask");
    const out = runScript(scriptPath, CLAUDE_STDIN);
    const decision = JSON.parse(out.trim());
    expect(decision.hookSpecificOutput?.permissionDecision).toBe("ask");
    expect(decision.hookSpecificOutput?.hookEventName).toBe("PreToolUse");
    expect(decision.hookSpecificOutput?.permissionDecisionReason).toContain("rm -rf /");
    // Must NOT carry a legacy block, which would override ask on Claude.
    expect(decision.decision).toBeUndefined();
  });

  it("ask mode + Codex payload: falls back to hard block (decision=block)", async () => {
    if (!hasJq()) return;
    const scriptPath = await buildScript("ask");
    const out = runScript(scriptPath, CODEX_STDIN);
    const decision = JSON.parse(out.trim());
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("rm -rf /");
    // No ask escalation for a runtime that does not understand it.
    expect(decision.hookSpecificOutput?.permissionDecision).not.toBe("ask");
  });

  it("block mode (default): Claude payload still gets a hard block", async () => {
    if (!hasJq()) return;
    const scriptPath = await buildScript("block");
    const out = runScript(scriptPath, CLAUDE_STDIN);
    const decision = JSON.parse(out.trim());
    expect(decision.decision).toBe("block");
    expect(decision.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it("block mode (default): Codex payload gets a hard block", async () => {
    if (!hasJq()) return;
    const scriptPath = await buildScript("block");
    const out = runScript(scriptPath, CODEX_STDIN);
    const decision = JSON.parse(out.trim());
    expect(decision.decision).toBe("block");
  });
});
