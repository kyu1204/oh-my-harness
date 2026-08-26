import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { OMH_DIR } from "../utils/paths.js";

/**
 * Loop state on disk, and the single-file lock that guards a run.
 *
 * `run.json` IS the lock: it is created with `link(2)`, which is atomic and
 * fails with EEXIST when another runner holds it, and its content names the
 * owner. There is no separate lock directory or owner file, so a reader can
 * never observe a half-acquired lock.
 */
export interface LoopPaths {
  dir: string;
  runJson: string;
  stopFlag: string;
  seedJson: string;
  runsDir: string;
  worktree: string;
  branch: "omh-loop";
}

export interface RunInfo {
  runId: string;
  pid: number;
  startedAt: string;
  runtime: string;
  iteration: number;
  childPid?: number;
  cwd: string;
}

export interface LoopEvent {
  ts: string;
  runId: string;
  kind: string;
  iteration?: number;
  message?: string;
  meta?: Record<string, unknown>;
}

export interface LivenessDeps {
  /** `ps -o args= -p <pid>`; null when ps is unavailable or the pid is gone. */
  psArgs?: (pid: number) => string | null;
}

export function loopPaths(projectDir: string): LoopPaths {
  const dir = path.join(projectDir, OMH_DIR, "state", "loop");
  return {
    dir,
    runJson: path.join(dir, "run.json"),
    stopFlag: path.join(dir, "stop"),
    seedJson: path.join(dir, "seed.json"),
    runsDir: path.join(dir, "runs"),
    worktree: path.join(projectDir, OMH_DIR, "loop", "worktree"),
    branch: "omh-loop",
  };
}

export function runDir(p: LoopPaths, runId: string): string {
  return path.join(p.runsDir, runId);
}

export function turnLogPath(p: LoopPaths, runId: string, iteration: number): string {
  return path.join(runDir(p, runId), "turns", `${String(iteration).padStart(3, "0")}.log`);
}

/** Write via a temp file and rename, so readers see the old or the new inode, never a truncated file. */
export function atomicWrite(filePath: string, content: string, mode?: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, "utf-8");
  if (mode !== undefined) fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, filePath);
}

function defaultPsArgs(pid: number): string | null {
  try {
    return execFileSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf-8" }).trim() || null;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: exists but not ours — alive. ESRCH: gone.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * A run is live when its pid exists AND, if ps can tell us, that pid is
 * really running this run (pid reuse after a SIGKILL would otherwise make
 * a stale run.json look alive and a bystander get signalled).
 */
export function isRunLive(run: RunInfo, deps: LivenessDeps = {}): boolean {
  if (!pidAlive(run.pid)) return false;
  const args = (deps.psArgs ?? defaultPsArgs)(run.pid);
  if (args === null) return true;
  return args.includes(`--run-id ${run.runId}`);
}

export function readRun(projectDir: string): RunInfo | null {
  try {
    return JSON.parse(fs.readFileSync(loopPaths(projectDir).runJson, "utf-8")) as RunInfo;
  } catch {
    return null;
  }
}

function tryLink(tmp: string, target: string): boolean {
  try {
    fs.linkSync(tmp, target);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

export function acquireRun(projectDir: string, info: RunInfo, deps: LivenessDeps = {}): boolean {
  const p = loopPaths(projectDir);
  fs.mkdirSync(p.dir, { recursive: true });
  const tmp = `${p.runJson}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(info, null, 2), "utf-8");
  try {
    if (tryLink(tmp, p.runJson)) return true;

    const existing = readRun(projectDir);
    if (!existing) return tryLink(tmp, p.runJson);
    if (isRunLive(existing, deps)) return false;
    if (!reclaimStaleRun(projectDir, existing)) return false;
    return tryLink(tmp, p.runJson);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Remove a stale run.json — but only the exact record that was observed to
 * be stale. Two runners that both judged the lock stale must not both win:
 * a reclaim lock (atomic mkdir) serialises them, and re-reading under that
 * lock rejects the case where the first winner has already installed a
 * fresh record that the second would otherwise steal.
 */
export function reclaimStaleRun(projectDir: string, observed: RunInfo): boolean {
  const p = loopPaths(projectDir);
  const lock = `${p.runJson}.reclaim`;
  const pidFile = path.join(lock, "pid");
  const takeLock = (): boolean => {
    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(pidFile, String(process.pid));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      return false;
    }
  };
  if (!takeLock()) {
    let holder = NaN;
    try {
      holder = Number(fs.readFileSync(pidFile, "utf-8"));
    } catch {
      // half-written lock; treat as dead (holder stays NaN)
    }
    if (Number.isFinite(holder) && pidAlive(holder)) return false;
    if (!takeoverReclaimLock(lock, holder)) return false;
    if (!takeLock()) return false;
  }
  try {
    const now = readRun(projectDir);
    const same =
      now !== null && now.runId === observed.runId && now.pid === observed.pid && now.startedAt === observed.startedAt;
    if (!same) return false;
    fs.rmSync(p.runJson, { force: true });
    return true;
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * Remove a reclaim lock left by a dead reclaimer — atomically. rm+mkdir would
 * let two cleaners race and one delete the other's fresh lock, so the dead
 * lock is first renamed to a private name (only one renamer succeeds), then
 * its recorded holder is checked against what we observed; a mismatch means
 * a live reclaimer took it meanwhile, and it is put back untouched.
 */
export function takeoverReclaimLock(lock: string, observedHolder: number): boolean {
  const mine = `${lock}.stale-${process.pid}`;
  try {
    fs.renameSync(lock, mine);
  } catch {
    return false; // already taken over by someone else, or gone
  }
  let holder = NaN;
  try {
    holder = Number(fs.readFileSync(path.join(mine, "pid"), "utf-8"));
  } catch {
    // unreadable: treat as the half-written lock we observed
  }
  const sameHolder = (Number.isNaN(holder) && Number.isNaN(observedHolder)) || holder === observedHolder;
  if (!sameHolder) {
    // Not the dead lock we judged — a fresh reclaimer's. Give it back.
    try {
      fs.renameSync(mine, lock);
    } catch {
      fs.rmSync(mine, { recursive: true, force: true });
    }
    return false;
  }
  fs.rmSync(mine, { recursive: true, force: true });
  return true;
}

export function updateRun(projectDir: string, patch: Partial<RunInfo>): void {
  const current = readRun(projectDir);
  if (!current) return;
  atomicWrite(loopPaths(projectDir).runJson, JSON.stringify({ ...current, ...patch }, null, 2));
}

/** Only the owning process may release: pid and runId must both match. */
export function releaseRun(projectDir: string, runId: string): void {
  const current = readRun(projectDir);
  if (!current || current.runId !== runId || current.pid !== process.pid) return;
  fs.rmSync(loopPaths(projectDir).runJson, { force: true });
}

export function appendEvent(projectDir: string, ev: Omit<LoopEvent, "ts">): void {
  const dir = runDir(loopPaths(projectDir), ev.runId);
  fs.mkdirSync(dir, { recursive: true });
  const line: LoopEvent = { ts: new Date().toISOString(), ...ev };
  fs.appendFileSync(path.join(dir, "events.jsonl"), JSON.stringify(line) + "\n", "utf-8");
}

export function readEvents(projectDir: string, runId: string): LoopEvent[] {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(runDir(loopPaths(projectDir), runId), "events.jsonl"), "utf-8");
  } catch {
    return [];
  }
  const out: LoopEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as LoopEvent);
    } catch {
      // a torn line from a crash mid-write is dropped, not fatal
    }
  }
  return out;
}

/** Run ids sort chronologically by construction (YYYYMMDD-HHmmss-xxxx). */
export function pruneRuns(projectDir: string, keep = 5): string[] {
  const p = loopPaths(projectDir);
  let names: string[];
  try {
    names = fs.readdirSync(p.runsDir).sort();
  } catch {
    return [];
  }
  const doomed = names.slice(0, Math.max(0, names.length - keep));
  for (const name of doomed) fs.rmSync(path.join(p.runsDir, name), { recursive: true, force: true });
  return doomed;
}
