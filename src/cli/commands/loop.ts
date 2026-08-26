import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import yaml from "js-yaml";
import chalk from "chalk";
import { HarnessConfigSchema } from "../../core/harness-schema.js";
import type { LoopConfig } from "../../core/merged-config.js";
import { loopPaths, readRun, isRunLive, pruneRuns, runDir, readEvents } from "../../loop/state.js";
import type { LivenessDeps } from "../../loop/state.js";
import { stopLoop, sweepOwnGroup } from "../../loop/stop.js";
import { runSupervisor } from "../../loop/supervisor.js";
import type { SupervisorExit } from "../../loop/supervisor.js";
import { currentBranch, git, removeWorktree, WorktreeError } from "../../loop/worktree.js";

/**
 * `omh loop` — the user-facing (and skill-facing) entry points to the
 * supervisor in src/loop. `start` launches `run` detached; everything else
 * reads or signals the state that `run` maintains.
 */
export interface LoopResult {
  exitCode: number;
}

/** The subset of ChildProcess that start relies on; injectable for tests. */
export interface ChildLike {
  pid?: number;
  exitCode: number | null;
  unref(): void;
  once(event: "exit", cb: (code: number | null) => void): unknown;
}
export type SpawnLike = (cmd: string, args: string[], opts: Record<string, unknown>) => ChildLike;

const fail = (msg: string): LoopResult => {
  console.error(chalk.red(`omh loop: ${msg}`));
  return { exitCode: 1 };
};

async function loadLoopConfig(projectDir: string): Promise<LoopConfig | LoopResult> {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(projectDir, "harness.yaml"), "utf-8");
  } catch {
    return fail("harness.yaml not found — run `omh init` first");
  }
  const parsed = HarnessConfigSchema.safeParse(yaml.load(raw));
  if (!parsed.success) return fail(`harness.yaml is invalid: ${parsed.error.issues[0]?.message ?? "schema error"}`);
  const loop = parsed.data.loop;
  if (!loop || !loop.enabled) return fail("the loop is disabled in harness.yaml (loop.enabled: false)");
  return loop as LoopConfig;
}

const isResult = (v: unknown): v is LoopResult => typeof v === "object" && v !== null && "exitCode" in v;

function newRunId(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}

// ---------------------------------------------------------------- start

export interface LoopStartOptions extends LivenessDeps {
  projectDir?: string;
  spawnImpl?: SpawnLike;
  platform?: NodeJS.Platform;
  /** How long to wait for the supervisor to acquire the run. */
  acquireTimeoutMs?: number;
}

export async function loopStartCommand(options: LoopStartOptions = {}): Promise<LoopResult> {
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return fail("the loop is POSIX-only (process groups and ps are required)");

  try {
    await git(projectDir, ["rev-parse", "--show-toplevel"]);
  } catch {
    return fail("not a git repository");
  }
  const cfg = await loadLoopConfig(projectDir);
  if (isResult(cfg)) return cfg;

  const p = loopPaths(projectDir);
  if ((await currentBranch(projectDir)) === p.branch) {
    return fail(`the main tree is checked out on ${p.branch}; switch branches first`);
  }
  if (!fs.existsSync(path.join(projectDir, cfg.ledger))) {
    return fail(`ledger ${cfg.ledger} not found — write it first (see the omh-loop skill)`);
  }
  const ordersDir = path.join(projectDir, cfg.workOrders);
  const orders = fs.existsSync(ordersDir) ? fs.readdirSync(ordersDir).filter((f) => f.endsWith(".md")) : [];
  if (orders.length === 0) return fail(`no work order found in ${cfg.workOrders}/ — the loop has nothing it may do`);

  const existing = readRun(projectDir);
  if (existing && isRunLive(existing, options)) {
    return fail(`a loop is already running (run ${existing.runId}, pid ${existing.pid}); \`omh loop stop\` first`);
  }
  if (existing?.childPid !== undefined) {
    // A SIGKILLed supervisor can leave its turn running; two loops must not
    // share the worktree, so the orphan has to be stopped first.
    try {
      process.kill(-existing.childPid, 0);
      return fail(`run ${existing.runId} left an orphaned turn still running (pid ${existing.childPid}); \`omh loop stop\` first`);
    } catch {
      // group gone — safe to reclaim
    }
  }

  pruneRuns(projectDir, 5);
  // Only start clears the flag. A stop issued between here and the
  // supervisor acquiring the run must not be lost, so run never clears it.
  fs.rmSync(p.stopFlag, { force: true });

  const runId = newRunId();
  const dir = runDir(p, runId);
  fs.mkdirSync(dir, { recursive: true });
  const logFd = fs.openSync(path.join(dir, "supervisor.log"), "a");
  const spawnImpl: SpawnLike = options.spawnImpl ?? ((cmd, args, opts) => spawn(cmd, args, opts) as unknown as ChildLike);
  const child = spawnImpl(
    process.execPath,
    [...process.execArgv, process.argv[1], "loop", "run", "--run-id", runId, "-d", projectDir],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, OMH_SKIP_VERSION_CHECK: "1" },
    },
  );

  // Wait until the supervisor owns the run (or died trying) before letting go.
  const acquired = await new Promise<number | "acquired">((resolve) => {
    let done = false;
    const settle = (v: number | "acquired") => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(limit);
      resolve(v);
    };
    child.once("exit", (code) => settle(code ?? 1));
    const poll = setInterval(() => {
      if (readRun(projectDir)?.runId === runId) settle("acquired");
    }, 100);
    const limit = setTimeout(() => settle(child.exitCode ?? 1), options.acquireTimeoutMs ?? 15_000);
  });
  fs.closeSync(logFd);

  // A very fast goal can run to completion — and release run.json — before
  // our first poll ever sees the record. Exit 0 plus events for this run id
  // is a finished loop, not a failed start.
  if (acquired === 0 && readEvents(projectDir, runId).length > 0) {
    const last = readEvents(projectDir, runId).at(-1);
    console.log(chalk.green(`omh loop: started run ${runId} (pid ${child.pid ?? "?"}) — it already finished (${last?.kind ?? "done"})`));
    console.log(`  events: ${path.join(dir, "events.jsonl")}`);
    return { exitCode: 0 };
  }
  if (acquired !== "acquired") {
    // Always let go of the handle: a still-running child would otherwise keep
    // this CLI process alive until the whole loop finished.
    child.unref();
    const stillRunning = child.exitCode === null;
    console.error(
      chalk.red(
        acquired === 3
          ? "omh loop: another loop is already running"
          : stillRunning
            ? `omh loop: the supervisor did not acquire the run within the timeout — see ${path.join(dir, "supervisor.log")}`
            : `omh loop: the supervisor exited with code ${acquired} before starting — see ${path.join(dir, "supervisor.log")}`,
      ),
    );
    // Exit 0 without any recorded event is not a success we can vouch for.
    return { exitCode: acquired === 0 ? 1 : acquired };
  }
  child.unref();
  console.log(chalk.green(`omh loop: started run ${runId} (pid ${child.pid ?? "?"})`));
  console.log(`  events: ${path.join(dir, "events.jsonl")}`);
  console.log(`  watch:  omh loop status  |  tail -f ${path.join(dir, "events.jsonl")}`);
  console.log("  stop:   omh loop stop");
  return { exitCode: 0 };
}

// ---------------------------------------------------------------- run

export interface LoopRunOptions {
  projectDir?: string;
  runId: string;
  supervisorImpl?: (o: { projectDir: string; cfg: LoopConfig; runId: string }) => Promise<SupervisorExit>;
  sweepImpl?: () => void;
}

export async function loopRunCommand(options: LoopRunOptions): Promise<LoopResult> {
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const cfg = await loadLoopConfig(projectDir);
  if (isResult(cfg)) return cfg;
  const run = options.supervisorImpl ?? ((o) => runSupervisor(o));
  const exit = await run({ projectDir, cfg, runId: options.runId });
  // Whatever a turn left behind in our process group goes with us.
  (options.sweepImpl ?? sweepOwnGroup)();
  switch (exit) {
    case "complete":
    case "stopped":
      return { exitCode: 0 };
    case "already-running":
      return { exitCode: 3 };
    case "failed":
      return { exitCode: 1 };
  }
}

// ---------------------------------------------------------------- stop

export interface LoopStopOptions {
  projectDir?: string;
  now?: boolean;
  stopImpl?: typeof stopLoop;
}

export async function loopStopCommand(options: LoopStopOptions = {}): Promise<LoopResult> {
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const run = readRun(projectDir);
  // Even with no record, stopLoop lays down the stop flag so a supervisor
  // mid-acquire still sees the request.
  await (options.stopImpl ?? stopLoop)(projectDir, { graceMs: options.now ? 1000 : 10_000 });
  if (!run) {
    console.log("omh loop: no active loop (stop flag recorded)");
    return { exitCode: 0 };
  }
  console.log(chalk.green(`omh loop: stopped run ${run.runId}`));
  return { exitCode: 0 };
}

// ---------------------------------------------------------------- status

export interface LoopStatusOptions extends LivenessDeps {
  projectDir?: string;
}

export async function loopStatusCommand(options: LoopStatusOptions = {}): Promise<LoopResult> {
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const run = readRun(projectDir);
  if (!run) {
    console.log("omh loop: no active loop");
    return { exitCode: 0 };
  }
  const live = isRunLive(run, options);
  const events = readEvents(projectDir, run.runId);
  const last = events.at(-1);
  console.log(`run:       ${run.runId} (${live ? "running" : "not running — stale record"})`);
  console.log(`pid:       ${run.pid}`);
  console.log(`runtime:   ${run.runtime}`);
  console.log(`iteration: ${run.iteration}`);
  console.log(`cwd:       ${run.cwd}`);
  if (last) console.log(`last:      ${last.kind}${last.message ? ` — ${last.message}` : ""} (${last.ts})`);
  console.log(`events:    ${path.join(runDir(loopPaths(projectDir), run.runId), "events.jsonl")}`);
  return { exitCode: 0 };
}

// ---------------------------------------------------------------- clean

export interface LoopCleanOptions {
  projectDir?: string;
  branch?: boolean;
}

export async function loopCleanCommand(options: LoopCleanOptions = {}): Promise<LoopResult> {
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const p = loopPaths(projectDir);
  await stopLoop(projectDir, { graceMs: 5000 });
  try {
    await removeWorktree(projectDir, { branch: options.branch });
  } catch (err) {
    if (!(err instanceof WorktreeError)) throw err;
    return fail(err.message);
  }
  fs.rmSync(p.stopFlag, { force: true });
  fs.rmSync(p.runJson, { force: true });
  console.log(chalk.green(`omh loop: cleaned worktree${options.branch ? ` and branch ${p.branch}` : ""}`));
  return { exitCode: 0 };
}
