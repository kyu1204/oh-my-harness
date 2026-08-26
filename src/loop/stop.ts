import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { loopPaths, readRun, isRunLive } from "./state.js";

/**
 * Ask a live loop to stop and wait until it has.
 *
 * Writes the stop flag (honoured at the next iteration boundary and polled
 * during a turn), then signals the supervisor's whole process group — it was
 * started detached, so its pid is the group id — which reaches the runtime
 * child even if the supervisor itself was SIGKILLed. Identity is verified
 * first: a pid file can outlive a killed runner and the pid be reused.
 */
export interface StopOptions {
  /** How long SIGTERM gets before SIGKILL. */
  graceMs?: number;
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // already gone
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function stopLoop(projectDir: string, opts: StopOptions = {}): Promise<void> {
  const graceMs = opts.graceMs ?? 10_000;
  const p = loopPaths(projectDir);
  // The flag goes down unconditionally: a supervisor that is between spawn
  // and acquiring run.json has no record yet, and a stop issued in that
  // window must still reach it at its first boundary check.
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.stopFlag, "");
  const run = readRun(projectDir);
  if (!run) return;

  // The in-flight turn runs in its own process group (see runtime.ts). Take
  // it down whether or not the supervisor is still alive — a SIGKILLed
  // supervisor leaves the turn orphaned.
  if (run.childPid !== undefined && groupAlive(run.childPid) && isTurnProcess(run.childPid, run.runtime)) {
    signalGroup(run.childPid, "SIGTERM");
    const deadline = Date.now() + graceMs;
    while (groupAlive(run.childPid) && Date.now() < deadline) await sleep(100);
    if (groupAlive(run.childPid)) signalGroup(run.childPid, "SIGKILL");
  }

  if (isRunLive(run)) {
    signalGroup(run.pid, "SIGTERM");
    const deadline = Date.now() + graceMs;
    while (groupAlive(run.pid) && Date.now() < deadline) await sleep(100);
    if (groupAlive(run.pid)) {
      signalGroup(run.pid, "SIGKILL");
      const hardDeadline = Date.now() + 2000;
      while (groupAlive(run.pid) && Date.now() < hardDeadline) await sleep(50);
    }
  }
  // Remove only the record we acted on: a concurrent start may have
  // legitimately reclaimed the stale record and linked a fresh run.json in
  // the meantime, and deleting that would leave a live supervisor lockless.
  const now = readRun(projectDir);
  if (now && now.runId === run.runId && now.pid === run.pid) {
    fs.rmSync(p.runJson, { force: true });
  }
}

/**
 * The childPid gets the same pid-reuse protection the supervisor pid gets
 * from isRunLive: signal it only if ps says the pid is actually running the
 * configured agent runtime.
 */
function isTurnProcess(pid: number, runtime: string): boolean {
  try {
    const args = execFileSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf-8" });
    return args.includes(runtime);
  } catch {
    return false;
  }
}

/** True when `pid` leads its own process group (a detached supervisor does). */
export function isGroupLeader(pid = process.pid): boolean {
  try {
    const pgid = Number(execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf-8" }).trim());
    return pgid === pid;
  } catch {
    return false;
  }
}

/**
 * Signal every other member of our own process group. A runtime turn can
 * leave daemons behind (codex parks a computer-use helper there); the
 * supervisor sweeps them on its way out so the group really is gone when
 * `omh loop stop`/`status` look. Only a group leader may do this — in any
 * other process (a test worker, an interactive shell) the group is not ours.
 */
export function sweepOwnGroup(): void {
  if (!isGroupLeader()) return;
  const ignore = () => undefined;
  process.on("SIGTERM", ignore);
  try {
    process.kill(-process.pid, "SIGTERM");
  } catch {
    // nothing else in the group
  } finally {
    // Give the signal a tick to be delivered to us before removing the guard.
    setTimeout(() => process.off("SIGTERM", ignore), 100).unref();
  }
}
