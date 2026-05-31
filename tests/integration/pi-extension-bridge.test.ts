import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { renderTemplate } from "../../src/catalog/template-engine.js";
import { wrapWithLogger } from "../../src/generators/hooks.js";
import { buildPiExtension } from "../../src/generators/pi-extension.js";
import { commandGuard } from "../../src/catalog/blocks/command-guard.js";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "omh-pi-bridge-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

function hasJq(): boolean {
  try {
    execSync("jq --version", { encoding: "utf-8", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

type ToolCallHandler = (
  event: { toolName: string; input: Record<string, unknown> },
  ctx: { hasUI: boolean; ui: { select: (title: string, options: string[]) => Promise<string | undefined> } },
) => Promise<{ block?: boolean; reason?: string } | undefined>;

// Render a command-guard hook in the given mode, write it under .omh/hooks,
// generate the pi bridge extension that targets it, write that to
// .pi/extensions, and dynamically import it to capture the tool_call handler.
async function setupBridge(mode: "block" | "ask", patterns: string[]): Promise<ToolCallHandler> {
  const rendered = renderTemplate(commandGuard.template, { patterns });
  const wrapped = wrapWithLogger(rendered, "PreToolUse", undefined, mode);
  await mkdir(join(projectDir, ".omh", "hooks"), { recursive: true });
  const scriptAbs = join(projectDir, ".omh", "hooks", "catalog-command-guard.sh");
  await writeFile(scriptAbs, wrapped, { mode: 0o755 });

  // Mirror the real emitter command format: `bash '<abs path>'`, run via shell.
  const code = buildPiExtension([{ tools: ["bash"], command: `bash '${scriptAbs}'` }]);
  await mkdir(join(projectDir, ".pi", "extensions"), { recursive: true });
  const extPath = join(projectDir, ".pi", "extensions", "omh-harness.ts");
  await writeFile(extPath, code, "utf-8");

  let captured: ToolCallHandler | undefined;
  const fakePi = {
    on: (event: string, handler: ToolCallHandler) => {
      if (event === "tool_call") captured = handler;
    },
  };
  const mod = await import(/* @vite-ignore */ extPath);
  mod.default(fakePi);
  if (!captured) throw new Error("extension did not register a tool_call handler");
  return captured;
}

describe.skipIf(!hasJq())("pi bridge extension (shells out to .omh/hooks/*.sh)", () => {
  it("ask mode + UI present + user approves: allows the tool (undefined)", async () => {
    const handler = await setupBridge("ask", ["OMH_ASK_DEMO"]);
    const ctx = { hasUI: true, ui: { select: async () => "Yes" } };
    const result = await handler({ toolName: "bash", input: { command: "echo OMH_ASK_DEMO" } }, ctx);
    expect(result).toBeUndefined();
  });

  it("ask mode + UI present + user declines: blocks", async () => {
    const handler = await setupBridge("ask", ["OMH_ASK_DEMO"]);
    const ctx = { hasUI: true, ui: { select: async () => "No" } };
    const result = await handler({ toolName: "bash", input: { command: "echo OMH_ASK_DEMO" } }, ctx);
    expect(result?.block).toBe(true);
  });

  it("ask mode + no UI: blocks by default (never silently allows)", async () => {
    const handler = await setupBridge("ask", ["OMH_ASK_DEMO"]);
    let selectCalled = false;
    const ctx = { hasUI: false, ui: { select: async () => { selectCalled = true; return "Yes"; } } };
    const result = await handler({ toolName: "bash", input: { command: "echo OMH_ASK_DEMO" } }, ctx);
    expect(result?.block).toBe(true);
    expect(selectCalled).toBe(false);
  });

  it("block mode: hard-blocks without prompting", async () => {
    const handler = await setupBridge("block", ["OMH_BLOCK_DEMO"]);
    let selectCalled = false;
    const ctx = { hasUI: true, ui: { select: async () => { selectCalled = true; return "Yes"; } } };
    const result = await handler({ toolName: "bash", input: { command: "echo OMH_BLOCK_DEMO" } }, ctx);
    expect(result?.block).toBe(true);
    expect(selectCalled).toBe(false);
    expect(result?.reason).toContain("OMH_BLOCK_DEMO");
  });

  it("non-matching command: passes through (undefined)", async () => {
    const handler = await setupBridge("ask", ["OMH_ASK_DEMO"]);
    const ctx = { hasUI: true, ui: { select: async () => "No" } };
    const result = await handler({ toolName: "bash", input: { command: "ls -la" } }, ctx);
    expect(result).toBeUndefined();
  });

  it("ignores tools it has no binding for", async () => {
    const handler = await setupBridge("ask", ["OMH_ASK_DEMO"]);
    const ctx = { hasUI: true, ui: { select: async () => "No" } };
    const result = await handler({ toolName: "read", input: { path: "/etc/hosts" } }, ctx);
    expect(result).toBeUndefined();
  });
});
