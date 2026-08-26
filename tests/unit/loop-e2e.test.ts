import { describe, it, expect, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { loopPaths, readRun, readEvents } from "../../src/loop/state.js";

/**
 * End to end through the real CLI (via tsx): start detaches a supervisor,
 * the supervisor drives a stub `claude` that finishes the goal, and stop
 * takes a long-running turn's whole process group down.
 */
const SLOW = 60_000;
const REPO = path.resolve(__dirname, "..", "..");
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");
const BIN = path.join(REPO, "bin", "oh-my-harness.ts");

let dir: string;
let bin: string;

function sh(args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf-8" }).trim();
}

function omh(args: string[]) {
  return spawnSync(TSX, [BIN, ...args, "-d", dir], {
    encoding: "utf-8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OMH_SKIP_VERSION_CHECK: "1" },
    timeout: 30_000,
  });
}

function stubClaude(script: string): void {
  const p = path.join(bin, "claude");
  fs.writeFileSync(p, `#!/usr/bin/env bash\n${script}\n`);
  fs.chmodSync(p, 0o755);
}

async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return pred();
}

const groupAlive = (pgid: number) => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "omh-e2e-"));
  bin = path.join(dir, "stubbin");
  fs.mkdirSync(bin);
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  sh(["config", "user.email", "t@t"]);
  sh(["config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, "harness.yaml"), yaml.dump({ version: "1.0", loop: { isolate: false, interval: 1, runtime: "claude" } }));
  fs.writeFileSync(path.join(dir, "WORKPLAN.md"), "- [ ] T-1\n");
  fs.mkdirSync(path.join(dir, "docs", "work-orders"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "work-orders", "T-1.md"), "# T-1\n");
  sh(["add", "."]);
  sh(["commit", "-qm", "init"]);
});

describe("omh loop e2e", () => {
  it("start returns at once, the detached supervisor completes the goal, run.json is released", async () => {
    // The stub agent ticks the task, commits, and prints the sentinel.
    // The stub also leaves a straggler behind in the process group, the way
    // codex leaves its computer-use daemon; the supervisor must sweep it.
    stubClaude(`
      cd "$PWD"
      nohup sleep 300 >/dev/null 2>&1 &
      sed -i '' 's/- \\[ \\] T-1/- [x] T-1/' WORKPLAN.md 2>/dev/null || sed -i 's/- \\[ \\] T-1/- [x] T-1/' WORKPLAN.md
      git add -A && git commit -qm "done T-1"
      echo "OMH_GOAL_COMPLETE"`);
    const started = Date.now();
    const r = omh(["loop", "start"]);
    expect(r.status, r.stderr).toBe(0);
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(r.stdout).toContain("started run");
    const runId = /started run (\S+)/.exec(r.stdout)![1];

    const done = await waitFor(() => readEvents(dir, runId).some((e) => e.kind === "complete"), 25_000);
    expect(done, JSON.stringify(readEvents(dir, runId))).toBe(true);
    expect(await waitFor(() => readRun(dir) === null, 5000)).toBe(true);
    expect(sh(["log", "--oneline"])).toContain("done T-1");
    const pid = Number(/pid (\d+)/.exec(r.stdout)![1]);
    expect(await waitFor(() => !groupAlive(pid), 5000), "straggler left the group alive").toBe(true);
  }, SLOW);

  it("stop --now takes a long-running turn's process group down", async () => {
    stubClaude("sleep 60");
    const r = omh(["loop", "start"]);
    expect(r.status, r.stderr).toBe(0);
    const run = readRun(dir)!;
    expect(run).not.toBeNull();
    expect(await waitFor(() => readRun(dir)?.childPid !== undefined, 10_000)).toBe(true);

    const stop = omh(["loop", "stop", "--now"]);
    expect(stop.status, stop.stderr).toBe(0);
    expect(await waitFor(() => !groupAlive(run.pid), 15_000)).toBe(true);
    expect(readRun(dir)).toBeNull();
    expect(readEvents(dir, run.runId).some((e) => e.kind === "stopped")).toBe(true);
  }, SLOW);

  it("a second start while one is running is refused", async () => {
    stubClaude("sleep 60");
    expect(omh(["loop", "start"]).status).toBe(0);
    const second = omh(["loop", "start"]);
    expect(second.status).not.toBe(0);
    expect(second.stderr).toMatch(/already running/);
    omh(["loop", "stop", "--now"]);
  }, SLOW);
});
