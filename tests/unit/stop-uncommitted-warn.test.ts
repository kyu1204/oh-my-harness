import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stopUncommittedWarn } from "../../src/catalog/blocks/stop-uncommitted-warn.js";
import { builtinBlocks } from "../../src/catalog/blocks/index.js";
import { renderTemplate } from "../../src/catalog/template-engine.js";
import { wrapWithLogger } from "../../src/generators/hooks.js";

// #117: a non-blocking Stop hook that surfaces leftover uncommitted changes
// as a system message, so the human sees what the turn left behind.

let dir: string;
let aux: string;      // the hook script lives outside the repo so it is not itself an uncommitted change

function sh(cmd: string) {
  return execSync(cmd, { cwd: dir, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] });
}
function hasJq(): boolean {
  try { sh("jq --version"); return true; } catch { return false; }
}
async function hook() {
  const p = join(aux, "stop-uncommitted-warn.sh");
  await writeFile(p, wrapWithLogger(renderTemplate(stopUncommittedWarn.template, {}), "Stop", dir), { mode: 0o755 });
  return p;
}
function stop(script: string): string {
  return execSync(`/bin/bash "${script}"`, { cwd: dir, encoding: "utf-8", timeout: 10_000, input: JSON.stringify({ session_id: "s", stop_hook_active: false }) });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omh-stop-warn-"));
  aux = await mkdtemp(join(tmpdir(), "omh-stop-warn-aux-"));
  sh("git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init");
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); await rm(aux, { recursive: true, force: true }); });

describe("stopUncommittedWarn block", () => {
  it("is a non-blocking Stop block and is registered", () => {
    expect(stopUncommittedWarn.id).toBe("stop-uncommitted-warn");
    expect(stopUncommittedWarn.event).toBe("Stop");
    expect(stopUncommittedWarn.canBlock).toBe(false);
    expect(stopUncommittedWarn.params).toEqual([]);
    expect(builtinBlocks.map((b) => b.id)).toContain("stop-uncommitted-warn");
  });
});

describe.skipIf(!hasJq())("stop-uncommitted-warn execution", () => {
  it("says nothing on a clean tree", async () => {
    expect(stop(await hook()).trim()).toBe("");
  });

  it("reports the count and the files as a systemMessage, never a block", async () => {
    await writeFile(join(dir, "a.txt"), "x\n");
    await writeFile(join(dir, "b.txt"), "y\n");
    const out = JSON.parse(stop(await hook()).trim());
    expect(out.decision).toBeUndefined();
    expect(out.systemMessage).toMatch(/2 uncommitted/);
    expect(out.systemMessage).toMatch(/a\.txt/);
    expect(out.systemMessage).toMatch(/b\.txt/);
  });

  it("reports a git status failure instead of treating it as a clean tree (review)", async () => {
    const { chmodSync } = await import("node:fs");
    await writeFile(join(dir, "a.txt"), "x\n");
    sh("git add a.txt");
    chmodSync(join(dir, ".git", "index"), 0o000);
    try {
      const out = JSON.parse(stop(await hook()).trim());
      expect(out.decision).toBeUndefined();
      expect(out.systemMessage).toMatch(/could not read git status/);
    } finally {
      chmodSync(join(dir, ".git", "index"), 0o644);
    }
  });

  it("stays quiet outside a git repository", async () => {
    await rm(join(dir, ".git"), { recursive: true, force: true });
    await writeFile(join(dir, "a.txt"), "x\n");
    expect(stop(await hook()).trim()).toBe("");
  });
});
