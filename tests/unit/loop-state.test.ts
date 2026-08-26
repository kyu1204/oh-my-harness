import { describe, it, expect, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  loopPaths,
  runDir,
  turnLogPath,
  acquireRun,
  readRun,
  updateRun,
  releaseRun,
  isRunLive,
  appendEvent,
  readEvents,
  pruneRuns,
  atomicWrite,
  reclaimStaleRun,
} from "../../src/loop/state.js";
import type { RunInfo } from "../../src/loop/state.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "omh-state-"));
});

function info(over: Partial<RunInfo> = {}): RunInfo {
  return { runId: "A", pid: process.pid, startedAt: "2026-01-01T00:00:00Z", runtime: "claude", iteration: 0, cwd: dir, ...over };
}
const psA = () => "node omh loop run --run-id A -d /x";

describe("loopPaths", () => {
  it("lays out state under .omh/state/loop and the worktree under .omh/loop", () => {
    const p = loopPaths(dir);
    expect(p.dir).toBe(path.join(dir, ".omh", "state", "loop"));
    expect(p.runJson).toBe(path.join(p.dir, "run.json"));
    expect(p.stopFlag).toBe(path.join(p.dir, "stop"));
    expect(p.seedJson).toBe(path.join(p.dir, "seed.json"));
    expect(p.runsDir).toBe(path.join(p.dir, "runs"));
    expect(p.worktree).toBe(path.join(dir, ".omh", "loop", "worktree"));
    expect(p.branch).toBe("omh-loop");
    expect(runDir(p, "R1")).toBe(path.join(p.runsDir, "R1"));
    expect(turnLogPath(p, "R1", 7)).toBe(path.join(p.runsDir, "R1", "turns", "007.log"));
  });
});

describe("acquireRun / release", () => {
  it("the second acquire fails while the first holder is live", () => {
    expect(acquireRun(dir, info({ runId: "A" }), { psArgs: psA })).toBe(true);
    expect(acquireRun(dir, info({ runId: "B" }), { psArgs: psA })).toBe(false);
    expect(readRun(dir)?.runId).toBe("A");
  });

  it("reclaims a run.json whose pid is dead", () => {
    const p = loopPaths(dir);
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(p.runJson, JSON.stringify(info({ runId: "DEAD", pid: 999999 })));
    expect(acquireRun(dir, info({ runId: "NEW" }), { psArgs: psA })).toBe(true);
    expect(readRun(dir)?.runId).toBe("NEW");
    expect(fs.readdirSync(p.dir).filter((f) => f.startsWith("run.json."))).toEqual([]);
  });

  it("reclaims a run.json whose pid is alive but belongs to a different run (pid reuse)", () => {
    const p = loopPaths(dir);
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(p.runJson, JSON.stringify(info({ runId: "OLD", pid: process.pid })));
    // ps says this pid is running something else entirely
    expect(acquireRun(dir, info({ runId: "NEW" }), { psArgs: () => "vim notes.txt" })).toBe(true);
    expect(readRun(dir)?.runId).toBe("NEW");
  });

  it("releases only when pid and runId both match", () => {
    acquireRun(dir, info({ runId: "A" }), { psArgs: psA });
    releaseRun(dir, "B");
    expect(readRun(dir)?.runId).toBe("A");
    const p = loopPaths(dir);
    fs.writeFileSync(p.runJson, JSON.stringify(info({ runId: "A", pid: 999999 })));
    releaseRun(dir, "A");
    expect(readRun(dir)?.runId).toBe("A");
    fs.writeFileSync(p.runJson, JSON.stringify(info({ runId: "A", pid: process.pid })));
    releaseRun(dir, "A");
    expect(readRun(dir)).toBeNull();
  });

  it("updateRun patches fields atomically", () => {
    acquireRun(dir, info({ runId: "A" }), { psArgs: psA });
    updateRun(dir, { iteration: 3, childPid: 4242 });
    expect(readRun(dir)).toMatchObject({ runId: "A", iteration: 3, childPid: 4242 });
  });
});

describe("isRunLive", () => {
  it("is false for a dead pid, false for a live pid running another run-id, true otherwise", () => {
    expect(isRunLive(info({ pid: 999999 }))).toBe(false);
    expect(isRunLive(info({ runId: "A" }), { psArgs: () => "vim" })).toBe(false);
    expect(isRunLive(info({ runId: "A" }), { psArgs: psA })).toBe(true);
    // ps unavailable → fall back to pid liveness only
    expect(isRunLive(info({ runId: "A" }), { psArgs: () => null })).toBe(true);
  });
});

describe("events", () => {
  it("appends and reads JSONL per run, isolating runs from each other", () => {
    appendEvent(dir, { runId: "A", kind: "start" });
    appendEvent(dir, { runId: "A", kind: "progress", iteration: 1, message: "ticked", meta: { head: "abc" } });
    appendEvent(dir, { runId: "B", kind: "start" });
    const a = readEvents(dir, "A");
    expect(a.map((e) => e.kind)).toEqual(["start", "progress"]);
    expect(a[1]).toMatchObject({ iteration: 1, message: "ticked", meta: { head: "abc" } });
    expect(a[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(readEvents(dir, "B")).toHaveLength(1);
    expect(readEvents(dir, "C")).toEqual([]);
  });
});

describe("pruneRuns", () => {
  it("keeps the newest N run directories and returns what it deleted", () => {
    const p = loopPaths(dir);
    for (let i = 1; i <= 7; i++) fs.mkdirSync(path.join(p.runsDir, `2026010${i}-000000-aaaa`), { recursive: true });
    const deleted = pruneRuns(dir, 5);
    expect(deleted).toEqual(["20260101-000000-aaaa", "20260102-000000-aaaa"]);
    expect(fs.readdirSync(p.runsDir)).toHaveLength(5);
  });
});

describe("atomicWrite", () => {
  it("replaces the inode rather than truncating in place, and applies the mode", () => {
    const f = path.join(dir, "x.sh");
    atomicWrite(f, "one", 0o755);
    const ino = fs.statSync(f).ino;
    atomicWrite(f, "two", 0o755);
    expect(fs.readFileSync(f, "utf-8")).toBe("two");
    expect(fs.statSync(f).ino).not.toBe(ino);
    expect(fs.statSync(f).mode & 0o111).toBeTruthy();
    expect(fs.readdirSync(dir).filter((n) => n.includes(".tmp-"))).toEqual([]);
  });
});

describe("reclaimStaleRun (L-25)", () => {
  const stale = () => info({ runId: "DEAD", pid: 999999, startedAt: "2020-01-01T00:00:00Z" });

  it("reclaims only when the record on disk still matches what was observed", () => {
    const p = loopPaths(dir);
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(p.runJson, JSON.stringify(stale()));
    expect(reclaimStaleRun(dir, stale())).toBe(true);
    expect(fs.existsSync(p.runJson)).toBe(false);
    expect(fs.existsSync(`${p.runJson}.reclaim`)).toBe(false);
  });

  it("refuses when another runner already replaced the stale record (the steal window)", () => {
    const p = loopPaths(dir);
    fs.mkdirSync(p.dir, { recursive: true });
    const fresh = info({ runId: "FRESH", pid: process.pid });
    fs.writeFileSync(p.runJson, JSON.stringify(fresh));
    expect(reclaimStaleRun(dir, stale())).toBe(false);
    expect(readRun(dir)?.runId).toBe("FRESH");
  });

  it("refuses while a live reclaimer holds the reclaim lock, and clears a dead reclaimer's", () => {
    const p = loopPaths(dir);
    fs.mkdirSync(`${p.runJson}.reclaim`, { recursive: true });
    fs.writeFileSync(`${p.runJson}.reclaim/pid`, String(process.pid));
    fs.writeFileSync(p.runJson, JSON.stringify(stale()));
    expect(reclaimStaleRun(dir, stale())).toBe(false);
    fs.writeFileSync(`${p.runJson}.reclaim/pid`, "999999");
    expect(reclaimStaleRun(dir, stale())).toBe(true);
  });

  it("acquireRun still reclaims a dead runner's record end to end", () => {
    const p = loopPaths(dir);
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(p.runJson, JSON.stringify(stale()));
    expect(acquireRun(dir, info({ runId: "NEW" }), { psArgs: () => "omh loop run --run-id NEW" })).toBe(true);
    expect(readRun(dir)?.runId).toBe("NEW");
  });
});
