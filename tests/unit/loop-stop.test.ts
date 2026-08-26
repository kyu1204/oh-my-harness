import { describe, it, expect, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { stopLoop, isGroupLeader, sweepOwnGroup } from "../../src/loop/stop.js";
import { loopPaths, readRun } from "../../src/loop/state.js";
import type { RunInfo } from "../../src/loop/state.js";

const SLOW = 20_000;
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "omh-stop-"));
});

function writeRun(info: Partial<RunInfo>): void {
  const p = loopPaths(dir);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.runJson, JSON.stringify({ runId: "X", pid: 1, startedAt: "", runtime: "claude", iteration: 0, cwd: dir, ...info }));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("stopLoop", () => {
  it("is a no-op without a run and leaves no stop flag behind", async () => {
    await stopLoop(dir, { graceMs: 500 });
    expect(fs.existsSync(loopPaths(dir).stopFlag)).toBe(false);
  });

  it("clears a stale run.json whose pid is dead", async () => {
    writeRun({ pid: 999999 });
    await stopLoop(dir, { graceMs: 500 });
    expect(readRun(dir)).toBeNull();
  });

  it("refuses to signal a live pid that is not running this run (pid reuse)", async () => {
    const bystander = spawn("sleep", ["30"]);
    writeRun({ runId: "X", pid: bystander.pid! });
    await stopLoop(dir, { graceMs: 500 });
    expect(alive(bystander.pid!)).toBe(true);
    bystander.kill();
    expect(readRun(dir)).toBeNull();
  }, SLOW);

  it("terminates the whole process group of a real supervisor and waits for it", async () => {
    // A stand-in supervisor: its own process group (detached) whose argv
    // names the run id, with a child that ignores TERM — the group SIGKILL
    // must reach it.
    const script = `exec -a "omh loop run --run-id X" bash -c 'trap "" TERM; sleep 30 & wait'`;
    const sup = spawn("bash", ["-c", script], { detached: true, stdio: "ignore" });
    sup.unref();
    await new Promise((r) => setTimeout(r, 300));
    writeRun({ runId: "X", pid: sup.pid! });
    const started = Date.now();
    await stopLoop(dir, { graceMs: 500 });
    expect(Date.now() - started).toBeLessThan(5000);
    // the group is gone: kill(-pgid, 0) throws ESRCH
    expect(() => process.kill(-sup.pid!, 0)).toThrow();
    expect(readRun(dir)).toBeNull();
    expect(fs.existsSync(loopPaths(dir).stopFlag)).toBe(true);
  }, SLOW);
});

describe("stopLoop — orphaned turn (round 9)", () => {
  it("kills the child's process group even when the supervisor itself is already dead", async () => {
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    child.unref();
    await new Promise((r) => setTimeout(r, 200));
    writeRun({ runId: "X", pid: 999999, childPid: child.pid! });
    await stopLoop(dir, { graceMs: 500 });
    await new Promise((r) => setTimeout(r, 200));
    expect(alive(child.pid!)).toBe(false);
  }, SLOW);
});

describe("group hygiene (L-21)", () => {
  it("isGroupLeader is false for this test process and true for a detached child", async () => {
    expect(isGroupLeader(process.pid)).toBe(false);
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    child.unref();
    await new Promise((r) => setTimeout(r, 200));
    expect(isGroupLeader(child.pid!)).toBe(true);
    child.kill();
  }, SLOW);

  it("sweepOwnGroup is a no-op when this process is not a group leader", () => {
    // If it signalled our group it would kill the vitest worker; surviving is the assertion.
    expect(() => sweepOwnGroup()).not.toThrow();
  });
});
