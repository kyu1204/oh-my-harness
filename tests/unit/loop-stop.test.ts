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
  it("writes the stop flag even without a run — a stop in start's acquire window must not be lost (L-27c)", async () => {
    await stopLoop(dir, { graceMs: 500 });
    expect(fs.existsSync(loopPaths(dir).stopFlag)).toBe(true);
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
    // the orphan must look like the runtime for the identity check to signal it
    const child = spawn("bash", ["-c", 'exec -a claude sleep 30'], { detached: true, stdio: "ignore" });
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

describe("stop/clean vs a concurrent acquire (L-27b,e,f)", () => {
  it("does not delete a run.json that changed since the snapshot", async () => {
    // Simulate: stop snapshots a stale record, then a new run acquires before
    // stop's final removal. stopLoop must leave the fresh lock alone.
    writeRun({ runId: "STALE", pid: 999999 });
    const stale = { ...JSON.parse(fs.readFileSync(loopPaths(dir).runJson, "utf-8")) };
    // a fresh run replaces it mid-stop; emulate by monkey-timing: replace the
    // record, then call stopLoop which re-reads before removing
    writeRun({ runId: "FRESH", pid: process.pid });
    // stopLoop must compare against ITS OWN snapshot; here the snapshot IS the
    // fresh record, so removal is fine. To exercise the guard we call the
    // internal path via a stale-snapshot double: first stop with the stale
    // record present, but swap the file during the child-grace window.
    void stale;
    // direct contract check: after stopLoop, a record NOT matching what it
    // read must survive. We emulate by pre-writing FRESH and asserting stop
    // removes only what it read (FRESH) — then re-run with a swap.
    await stopLoop(dir, { graceMs: 100 });
    expect(readRun(dir)).toBeNull();
    // swap case: dead-child grace lets us interleave
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    child.unref();
    await new Promise((r) => setTimeout(r, 150));
    writeRun({ runId: "OLD", pid: 999999, childPid: child.pid! });
    const p = stopLoop(dir, { graceMs: 1500 });
    await new Promise((r) => setTimeout(r, 300));
    writeRun({ runId: "NEW", pid: process.pid });
    await p;
    expect(readRun(dir)?.runId).toBe("NEW");
    child.kill();
  }, SLOW);

  it("only signals a childPid whose process is actually the configured runtime (L-27e identity)", async () => {
    const bystander = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    bystander.unref();
    const exited = new Promise<boolean>((r) => {
      const t = setTimeout(() => r(false), 2000);
      bystander.on("exit", () => { clearTimeout(t); r(true); });
    });
    await new Promise((r) => setTimeout(r, 150));
    // dead supervisor, childPid reused by an unrelated process ("sleep", not claude)
    writeRun({ runId: "X", pid: 999999, childPid: bystander.pid!, runtime: "claude" });
    await stopLoop(dir, { graceMs: 300 });
    expect(await exited).toBe(false);
    bystander.kill();
  }, SLOW);
});

describe("childPid identity is token-exact (round 10)", () => {
  it("does not treat 'pip' as the 'pi' runtime — substring matches are not identity", async () => {
    const bystander = spawn("bash", ["-c", "exec -a pip-unrelated-job sleep 30"], { detached: true, stdio: "ignore" });
    bystander.unref();
    const exited = new Promise<boolean>((r) => {
      const t = setTimeout(() => r(false), 2000);
      bystander.on("exit", () => { clearTimeout(t); r(true); });
    });
    await new Promise((r) => setTimeout(r, 200));
    writeRun({ runId: "X", pid: 999999, childPid: bystander.pid!, runtime: "pi" });
    await stopLoop(dir, { graceMs: 300 });
    expect(await exited, "a pip process was killed as if it were the pi runtime").toBe(false);
    bystander.kill();
  }, SLOW);
});

describe("stopLoop — leaderless turn group (round 11)", () => {
  it("signals a group whose leader is dead — members are the turn's remnants", async () => {
    const leader = spawn("bash", ["-c", "sleep 30 & disown; exit 0"], { detached: true, stdio: "ignore" });
    leader.unref();
    const lp = leader.pid!;
    for (let i = 0; i < 40; i++) {
      const leaderDead = (() => { try { process.kill(lp, 0); return false; } catch { return true; } })();
      if (leaderDead) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    writeRun({ runId: "X", pid: 999999, childPid: lp, runtime: "claude" });
    await stopLoop(dir, { graceMs: 300 });
    await new Promise((r) => setTimeout(r, 200));
    const groupAlive = (() => { try { process.kill(-lp, 0); return true; } catch { return false; } })();
    expect(groupAlive, "leaderless turn remnants survived stop").toBe(false);
  }, SLOW);
});
