import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import yaml from "js-yaml";
import { loopPaths, readRun } from "../../src/loop/state.js";
import { ensureWorktree } from "../../src/loop/worktree.js";
import type { SpawnLike, ChildLike } from "../../src/cli/commands/loop.js";

let dir: string;
let logs: string[];
let errors: string[];

function sh(args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf-8" }).trim();
}

function gitRepo(): void {
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  sh(["config", "user.email", "t@t"]);
  sh(["config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, "README.md"), "x");
  sh(["add", "."]);
  sh(["commit", "-qm", "init"]);
}

function harness(loop: Record<string, unknown> = {}): void {
  fs.writeFileSync(path.join(dir, "harness.yaml"), yaml.dump({ version: "1.0", loop }));
}

function ledgerAndOrders(): void {
  fs.writeFileSync(path.join(dir, "WORKPLAN.md"), "- [ ] T-1\n");
  fs.mkdirSync(path.join(dir, "docs", "work-orders"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "work-orders", "T-1.md"), "# T-1\n");
}

/** A fake detached supervisor: writes run.json for the run id it was given, or exits. */
function fakeSpawn(behaviour: "runs" | "exits3" | "never" | "finishes" | "exits0"): SpawnLike & { calls: string[][]; unrefs: number } {
  const spy = Object.assign(
    (_cmd: string, args: string[]): ChildLike => {
      spy.calls.push(args);
      const child = new EventEmitter() as EventEmitter & ChildLike;
      child.pid = 4242;
      child.exitCode = null;
      child.unref = () => { spy.unrefs++; };
      const runId = args[args.indexOf("--run-id") + 1];
      setTimeout(() => {
        if (behaviour === "runs") {
          const p = loopPaths(dir);
          fs.mkdirSync(p.dir, { recursive: true });
          fs.writeFileSync(p.runJson, JSON.stringify({ runId, pid: 4242, startedAt: "", runtime: "claude", iteration: 0, cwd: dir }));
        } else if (behaviour === "exits3") {
          child.exitCode = 3;
          child.emit("exit", 3);
        } else if (behaviour === "exits0") {
          child.exitCode = 0;
          child.emit("exit", 0);
        } else if (behaviour === "finishes") {
          // a very fast goal: the supervisor ran, completed, released run.json
          // and exited 0 before start ever saw the record
          const p = loopPaths(dir);
          fs.mkdirSync(path.join(p.runsDir, runId), { recursive: true });
          fs.writeFileSync(path.join(p.runsDir, runId, "events.jsonl"),
            JSON.stringify({ ts: "t", runId, kind: "start" }) + "\n" + JSON.stringify({ ts: "t", runId, kind: "complete" }) + "\n");
          child.exitCode = 0;
          child.emit("exit", 0);
        }
      }, 50);
      return child;
    },
    { calls: [] as string[][], unrefs: 0 },
  );
  return spy;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "omh-cli-loop-"));
  logs = [];
  errors = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a.join(" ")); });
});
afterEach(() => vi.restoreAllMocks());

describe("omh loop start — preflight", () => {
  it("refuses on win32", async () => {
    const { loopStartCommand } = await import("../../src/cli/commands/loop.js");
    const r = await loopStartCommand({ projectDir: dir, platform: "win32", spawnImpl: fakeSpawn("runs") });
    expect(r.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/POSIX/);
  });

  it("refuses outside a git repository", async () => {
    const { loopStartCommand } = await import("../../src/cli/commands/loop.js");
    harness();
    const r = await loopStartCommand({ projectDir: dir, spawnImpl: fakeSpawn("runs") });
    expect(r.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/git repository/);
  });

  it("refuses when the loop is disabled in harness.yaml", async () => {
    const { loopStartCommand } = await import("../../src/cli/commands/loop.js");
    gitRepo();
    harness({ enabled: false });
    const r = await loopStartCommand({ projectDir: dir, spawnImpl: fakeSpawn("runs") });
    expect(r.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/disabled/);
  });

  it("refuses when the main tree is on omh-loop", async () => {
    const { loopStartCommand } = await import("../../src/cli/commands/loop.js");
    gitRepo();
    harness();
    ledgerAndOrders();
    sh(["checkout", "-qb", "omh-loop"]);
    const r = await loopStartCommand({ projectDir: dir, spawnImpl: fakeSpawn("runs") });
    expect(r.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/omh-loop/);
  });

  it("refuses without a ledger, and without any work order", async () => {
    const { loopStartCommand } = await import("../../src/cli/commands/loop.js");
    gitRepo();
    harness();
    let r = await loopStartCommand({ projectDir: dir, spawnImpl: fakeSpawn("runs") });
    expect(r.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/WORKPLAN\.md/);
    fs.writeFileSync(path.join(dir, "WORKPLAN.md"), "- [ ] T-1\n");
    errors = [];
    r = await loopStartCommand({ projectDir: dir, spawnImpl: fakeSpawn("runs") });
    expect(r.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/work order/);
  });

  it("refuses when a live run already holds run.json", async () => {
    const { loopStartCommand } = await import("../../src/cli/commands/loop.js");
    gitRepo();
    harness();
    ledgerAndOrders();
    const p = loopPaths(dir);
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(p.runJson, JSON.stringify({ runId: "LIVE", pid: process.pid, startedAt: "", runtime: "claude", iteration: 2, cwd: dir }));
    const r = await loopStartCommand({ projectDir: dir, spawnImpl: fakeSpawn("runs"), psArgs: () => "omh loop run --run-id LIVE" });
    expect(r.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/already running/);
  });
});

describe("omh loop start — orphaned turn (L-27f)", () => {
  it("refuses to reclaim a stale run while its turn group is still alive", async () => {
    const { loopStartCommand } = await import("../../src/cli/commands/loop.js");
    gitRepo();
    harness();
    ledgerAndOrders();
    const { spawn } = await import("node:child_process");
    const orphan = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    orphan.unref();
    await new Promise((r) => setTimeout(r, 150));
    const p = loopPaths(dir);
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(p.runJson, JSON.stringify({ runId: "DEAD", pid: 999999, startedAt: "", runtime: "claude", iteration: 1, childPid: orphan.pid, cwd: dir }));
    const r = await loopStartCommand({ projectDir: dir, spawnImpl: fakeSpawn("runs") });
    expect(r.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/orphaned turn|omh loop stop/);
    orphan.kill();
  }, 20_000);
});

describe("omh loop start — unborn HEAD (L-28c)", () => {
  it("fails with a message, not an unhandled WorktreeError, in a repo with no commits", async () => {
    const { loopStartCommand } = await import("../../src/cli/commands/loop.js");
    execFileSync("git", ["init", "-q", "-b", "main", dir]);
    harness();
    ledgerAndOrders();
    const r = await loopStartCommand({ projectDir: dir, spawnImpl: fakeSpawn("runs") });
    expect(r.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/commit|HEAD/i);
  });
});

describe("omh loop start — launch", () => {
  it("spawns a detached supervisor, waits for run.json, then unrefs and reports", async () => {
    const { loopStartCommand } = await import("../../src/cli/commands/loop.js");
    gitRepo();
    harness();
    ledgerAndOrders();
    const p = loopPaths(dir);
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(p.stopFlag, "");
    const spawnImpl = fakeSpawn("runs");
    const r = await loopStartCommand({ projectDir: dir, spawnImpl });
    expect(r.exitCode).toBe(0);
    expect(spawnImpl.calls).toHaveLength(1);
    const args = spawnImpl.calls[0];
    expect(args).toEqual(expect.arrayContaining(["loop", "run", "--run-id", "-d", dir]));
    expect(args[args.indexOf("--run-id") + 1]).toMatch(/^\d{8}-\d{6}-[0-9a-f]{4}$/);
    expect(spawnImpl.unrefs).toBe(1);
    expect(fs.existsSync(p.stopFlag)).toBe(false);
    expect(logs.join("\n")).toMatch(/omh loop status/);
    expect(readRun(dir)?.runId).toBe(args[args.indexOf("--run-id") + 1]);
  });

  it("treats a supervisor that finished the goal before start saw run.json as success", async () => {
    const { loopStartCommand } = await import("../../src/cli/commands/loop.js");
    gitRepo();
    harness();
    ledgerAndOrders();
    const r = await loopStartCommand({ projectDir: dir, spawnImpl: fakeSpawn("finishes") });
    expect(r.exitCode).toBe(0);
    expect(logs.join("\n")).toMatch(/started run \S+ \(pid 4242\)/);
    expect(logs.join("\n")).toMatch(/complete/);
    expect(errors).toEqual([]);
  });

  it("gives up on an acquisition timeout without hanging: exit 1 and the child is unref'd", async () => {
    const { loopStartCommand } = await import("../../src/cli/commands/loop.js");
    gitRepo();
    harness();
    ledgerAndOrders();
    const spawnImpl = fakeSpawn("never");
    const r = await loopStartCommand({ projectDir: dir, spawnImpl, acquireTimeoutMs: 300 });
    expect(r.exitCode).toBe(1);
    expect(spawnImpl.unrefs).toBe(1);
    expect(errors.join("\n")).toMatch(/did not acquire|before starting/);
  });

  it("an exit 0 with no events for the run is a failed start, not a success", async () => {
    const { loopStartCommand } = await import("../../src/cli/commands/loop.js");
    gitRepo();
    harness();
    ledgerAndOrders();
    const spawnImpl = fakeSpawn("exits0");
    const r = await loopStartCommand({ projectDir: dir, spawnImpl });
    expect(r.exitCode).toBe(1);
    expect(spawnImpl.unrefs).toBe(1);
  });

  it("surfaces the child's exit code when it dies before acquiring the run", async () => {
    const { loopStartCommand } = await import("../../src/cli/commands/loop.js");
    gitRepo();
    harness();
    ledgerAndOrders();
    const r = await loopStartCommand({ projectDir: dir, spawnImpl: fakeSpawn("exits3") });
    expect(r.exitCode).toBe(3);
  });
});

describe("omh loop status / stop / clean / run", () => {
  it("status reports no active loop, or the live run", async () => {
    const { loopStatusCommand } = await import("../../src/cli/commands/loop.js");
    expect((await loopStatusCommand({ projectDir: dir })).exitCode).toBe(0);
    expect(logs.join("\n")).toMatch(/no active loop/i);
    const p = loopPaths(dir);
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(p.runJson, JSON.stringify({ runId: "R9", pid: process.pid, startedAt: "", runtime: "claude", iteration: 4, cwd: dir }));
    logs = [];
    expect((await loopStatusCommand({ projectDir: dir, psArgs: () => "omh loop run --run-id R9" })).exitCode).toBe(0);
    expect(logs.join("\n")).toContain("R9");
    expect(logs.join("\n")).toContain("4");
    expect(logs.join("\n")).toContain(path.join(p.runsDir, "R9", "events.jsonl"));
  });

  it("stop is a no-op without a run and delegates to stopLoop with the grace period", async () => {
    const { loopStopCommand } = await import("../../src/cli/commands/loop.js");
    expect((await loopStopCommand({ projectDir: dir })).exitCode).toBe(0);
    const stopImpl = vi.fn(async () => {});
    const p = loopPaths(dir);
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(p.runJson, JSON.stringify({ runId: "R1", pid: 999999, startedAt: "", runtime: "claude", iteration: 0, cwd: dir }));
    expect((await loopStopCommand({ projectDir: dir, now: true, stopImpl })).exitCode).toBe(0);
    expect(stopImpl).toHaveBeenCalledWith(dir, { graceMs: 1000 });
  });

  it("clean removes the worktree and stale state files", async () => {
    const { loopCleanCommand } = await import("../../src/cli/commands/loop.js");
    gitRepo();
    const wt = (await ensureWorktree(dir)).path;
    const p = loopPaths(dir);
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(p.stopFlag, "");
    fs.writeFileSync(p.runJson, JSON.stringify({ runId: "OLD", pid: 999999, startedAt: "", runtime: "claude", iteration: 0, cwd: dir }));
    expect((await loopCleanCommand({ projectDir: dir, branch: true })).exitCode).toBe(0);
    expect(fs.existsSync(wt)).toBe(false);
    expect(fs.existsSync(p.stopFlag)).toBe(false);
    expect(readRun(dir)).toBeNull();
    expect(sh(["branch", "--list", "omh-loop"])).toBe("");
  }, 20_000);

  it("run maps the supervisor exit to a process exit code", async () => {
    const { loopRunCommand } = await import("../../src/cli/commands/loop.js");
    gitRepo();
    harness();
    ledgerAndOrders();
    const sweepImpl = vi.fn();
    for (const [exit, code] of [["complete", 0], ["stopped", 0], ["already-running", 3], ["failed", 1]] as const) {
      const r = await loopRunCommand({ projectDir: dir, runId: "R", supervisorImpl: async () => exit, sweepImpl });
      expect(r.exitCode).toBe(code);
    }
    // stragglers a turn left in our process group are swept after every run
    expect(sweepImpl).toHaveBeenCalledTimes(4);
  });
});
