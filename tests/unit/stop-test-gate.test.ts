import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stopTestGate } from "../../src/catalog/blocks/stop-test-gate.js";
import { builtinBlocks } from "../../src/catalog/blocks/index.js";
import { renderTemplate } from "../../src/catalog/template-engine.js";
import { wrapWithLogger } from "../../src/generators/hooks.js";

// #117: a Stop hook that refuses to let the turn end on a red test suite,
// with a per-session retry cap so it can never loop forever, and the same
// tree-fingerprint cache as commit-test-gate.

let dir: string;
let aux: string;      // scripts and markers live here, outside the repo, so they never change its tree
let marker: string;

function sh(cmd: string) {
  return execSync(cmd, { cwd: dir, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] });
}
function hasJq(): boolean {
  try { sh("jq --version"); return true; } catch { return false; }
}
async function gate(params: Record<string, unknown>) {
  const p = join(aux, "stop-test-gate.sh");
  await writeFile(p, wrapWithLogger(renderTemplate(stopTestGate.template, params), "Stop", dir), { mode: 0o755 });
  return p;
}
function stop(script: string, input: object): string {
  try {
    return execSync(`/bin/bash "${script}"`, { cwd: dir, encoding: "utf-8", timeout: 10_000, input: JSON.stringify(input) });
  } catch (e) {
    return (e as { stdout?: string }).stdout ?? "";
  }
}
const decision = (out: string) => (out.trim() ? JSON.parse(out.trim()) : undefined);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omh-stop-gate-"));
  aux = await mkdtemp(join(tmpdir(), "omh-stop-gate-aux-"));
  marker = join(aux, "runs.log");
  sh("git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init");
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); await rm(aux, { recursive: true, force: true }); });

describe("stopTestGate block", () => {
  it("has correct metadata and is registered", () => {
    expect(stopTestGate.id).toBe("stop-test-gate");
    expect(stopTestGate.event).toBe("Stop");
    expect(stopTestGate.matcher).toBeUndefined();
    expect(stopTestGate.canBlock).toBe(true);
    expect(stopTestGate.params.map((p) => p.name)).toEqual(["testCommand", "maxRetries", "cacheTtlSeconds"]);
    expect(stopTestGate.params.find((p) => p.name === "maxRetries")!.default).toBe(2);
    expect(builtinBlocks.map((b) => b.id)).toContain("stop-test-gate");
    expect(stopTestGate.explain?.change).toBeTruthy();
  });
});

describe.skipIf(!hasJq())("stop-test-gate execution", () => {
  const failing = `bash -c 'echo run >> "${"__MARKER__"}"; echo "FAIL: 1 test failed"; exit 1'`;

  it("blocks the stop with the failure tail when the test command fails, in Claude's Stop JSON shape", async () => {
    const s = await gate({ testCommand: failing.replace("__MARKER__", marker), maxRetries: 2, cacheTtlSeconds: 0 });
    const d = decision(stop(s, { session_id: "s1", stop_hook_active: false, hook_event_name: "Stop" }));
    expect(d.decision).toBe("block");
    expect(d.hookSpecificOutput).toMatchObject({ hookEventName: "Stop", decision: "block" });
    expect(d.reason).toMatch(/1 test failed/);
    expect(d.reason).toMatch(/attempt 1\/2/);
  });

  it("never blocks while a Stop hook is already active (loop guard), and does not run the tests", async () => {
    const s = await gate({ testCommand: failing.replace("__MARKER__", marker), maxRetries: 2, cacheTtlSeconds: 0 });
    expect(stop(s, { session_id: "s1", stop_hook_active: true }).trim()).toBe("");
    expect(existsSync(marker)).toBe(false);
  });

  it("gives up after maxRetries blocks in the same session, then allows", async () => {
    const s = await gate({ testCommand: failing.replace("__MARKER__", marker), maxRetries: 2, cacheTtlSeconds: 0 });
    expect(decision(stop(s, { session_id: "s2", stop_hook_active: false })).decision).toBe("block");
    expect(decision(stop(s, { session_id: "s2", stop_hook_active: false })).decision).toBe("block");
    expect(stop(s, { session_id: "s2", stop_hook_active: false }).trim()).toBe("");
    // another session starts fresh
    expect(decision(stop(s, { session_id: "s3", stop_hook_active: false })).decision).toBe("block");
    expect((await readFile(marker, "utf-8")).split("\n").filter(Boolean)).toHaveLength(3);
  });

  it("allows when the tests pass and resets the counter", async () => {
    const passing = `bash -c 'echo run >> "${marker}"'`;
    const s = await gate({ testCommand: passing, maxRetries: 2, cacheTtlSeconds: 600 });
    expect(stop(s, { session_id: "s4", stop_hook_active: false }).trim()).toBe("");
    // second stop on the same tree is served from the fingerprint cache
    expect(stop(s, { session_id: "s4", stop_hook_active: false }).trim()).toBe("");
    expect((await readFile(marker, "utf-8")).split("\n").filter(Boolean)).toHaveLength(1);
  });
});
