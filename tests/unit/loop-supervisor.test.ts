import { describe, it, expect, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { runSupervisor } from "../../src/loop/supervisor.js";
import type { SupervisorDeps } from "../../src/loop/supervisor.js";
import type { TurnOptions, TurnResult } from "../../src/loop/runtime.js";
import { loopPaths, readRun, readEvents, acquireRun } from "../../src/loop/state.js";
import { HarnessConfigSchema } from "../../src/core/harness-schema.js";
import type { LoopConfig } from "../../src/core/merged-config.js";

const SLOW = 30_000;

function sh(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf-8" }).trim();
}

function cfgWith(over: Partial<LoopConfig> = {}): LoopConfig {
  const parsed = HarnessConfigSchema.parse({ version: "1.0", loop: { isolate: false, interval: 1, ...over } });
  return parsed.loop as LoopConfig;
}

interface Repo { dir: string; cfg: LoopConfig }

function makeRepo(tasks: string[], over: Partial<LoopConfig> = {}): Repo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omh-sup-"));
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  sh(dir, ["config", "user.email", "t@t"]);
  sh(dir, ["config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, "WORKPLAN.md"), tasks.map((t) => `- [ ] ${t}`).join("\n") + "\n");
  fs.mkdirSync(path.join(dir, "docs", "work-orders"), { recursive: true });
  for (const t of tasks) fs.writeFileSync(path.join(dir, "docs", "work-orders", `${t}.md`), `# ${t}\n`);
  sh(dir, ["add", "."]);
  sh(dir, ["commit", "-qm", "init"]);
  return { dir, cfg: cfgWith(over) };
}

/** A turn stub that mutates the repo the way a real agent would. */
type Turn = (cwd: string, iteration: number, o: TurnOptions) => Promise<Partial<TurnResult>> | Partial<TurnResult>;

function deps(turn: Turn): SupervisorDeps & { sleeps: number[]; iterations: number } {
  const d = {
    sleeps: [] as number[],
    iterations: 0,
    async runTurn(o: TurnOptions): Promise<TurnResult> {
      d.iterations++;
      fs.mkdirSync(path.dirname(o.logPath), { recursive: true });
      const r = await turn(o.cwd, d.iterations, o);
      fs.writeFileSync(o.logPath, r.tail ?? "");
      return { status: 0, signal: null, timedOut: false, stoppedByRequest: false, tail: "", ...r };
    },
    async sleep(ms: number) {
      d.sleeps.push(ms);
    },
  };
  return d;
}

function tick(cwd: string, task: string): void {
  const p = path.join(cwd, "WORKPLAN.md");
  fs.writeFileSync(p, fs.readFileSync(p, "utf-8").replace(`- [ ] ${task}`, `- [x] ${task}`));
  sh(cwd, ["add", "."]);
  sh(cwd, ["commit", "-qm", `done ${task}`]);
}

let repo: Repo;
beforeEach(() => {
  repo = makeRepo(["T-1"]);
});

describe("runSupervisor — skeleton", () => {
  it("runs a turn that finishes the goal, records events, and releases the run", async () => {
    const d = deps((cwd) => {
      tick(cwd, "T-1");
      return { tail: "all done\nOMH_GOAL_COMPLETE\n" };
    });
    const exit = await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "R1" }, d);
    expect(exit).toBe("complete");
    const kinds = readEvents(repo.dir, "R1").map((e) => e.kind);
    expect(kinds[0]).toBe("start");
    expect(kinds.at(-1)).toBe("complete");
    expect(readRun(repo.dir)).toBeNull();
    expect(fs.existsSync(path.join(loopPaths(repo.dir).runsDir, "R1", "turns", "001.log"))).toBe(true);
  }, SLOW);

  it("passes the loop marker and run id to the runtime child", async () => {
    let env: NodeJS.ProcessEnv = {};
    const d = deps((cwd, _i, o) => {
      env = o.env;
      tick(cwd, "T-1");
      return { tail: "OMH_GOAL_COMPLETE\n" };
    });
    await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "R2" }, d);
    expect(env.OMH_LOOP).toBe("1");
    expect(env.OMH_LOOP_RUN_ID).toBe("R2");
  }, SLOW);

  it("reports already-running when a live run holds the lock", async () => {
    acquireRun(repo.dir, { runId: "HELD", pid: process.pid, startedAt: "", runtime: "claude", iteration: 0, cwd: repo.dir }, { psArgs: () => "omh loop run --run-id HELD" });
    const d = deps(() => ({ tail: "" }));
    // the supervisor itself checks liveness with ps; our own pid is alive and
    // the lock is ours, so we make ps agree it belongs to HELD
    const exit = await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "R3", psArgs: () => "omh loop run --run-id HELD" }, d);
    expect(exit).toBe("already-running");
    expect(d.iterations).toBe(0);
    expect(readEvents(repo.dir, "R3").map((e) => e.kind)).toEqual(["already-running"]);
  }, SLOW);

  it("waits the configured interval between progress turns", async () => {
    repo = makeRepo(["T-1", "T-2"], { interval: 7 });
    const d = deps((cwd, i) => {
      tick(cwd, `T-${i}`);
      return { tail: i === 2 ? "OMH_GOAL_COMPLETE\n" : "one done\n" };
    });
    const exit = await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "R4" }, d);
    expect(exit).toBe("complete");
    expect(d.sleeps).toEqual([7000]);
    expect(readEvents(repo.dir, "R4").map((e) => e.kind)).toEqual(["start", "progress", "complete"]);
  }, SLOW);

  it("stops at the iteration boundary when the stop flag appears", async () => {
    repo = makeRepo(["T-1", "T-2"]);
    const d = deps((cwd, i) => {
      tick(cwd, `T-${i}`);
      fs.writeFileSync(loopPaths(repo.dir).stopFlag, "");
      return { tail: "one done\n" };
    });
    const exit = await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "R5" }, d);
    expect(exit).toBe("stopped");
    expect(d.iterations).toBe(1);
    expect(readEvents(repo.dir, "R5").map((e) => e.kind)).toEqual(["start", "progress", "stopped"]);
    expect(readRun(repo.dir)).toBeNull();
  }, SLOW);

  it("honours maxIterations as a test/backstop limit", async () => {
    const d = deps(() => ({ tail: "nothing\n" }));
    const exit = await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "R6", maxIterations: 2 }, d);
    expect(exit).toBe("stopped");
    expect(d.iterations).toBe(2);
  }, SLOW);
});
