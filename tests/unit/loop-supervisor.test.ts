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

describe("runSupervisor — matrix", () => {
  const kinds = (dir: string, runId: string) => readEvents(dir, runId).map((e) => e.kind);

  function blockTask(cwd: string, task: string): void {
    const p = path.join(cwd, "WORKPLAN.md");
    fs.writeFileSync(p, fs.readFileSync(p, "utf-8").replace(`- [ ] ${task}`, `- [ ] ${task} BLOCKED: no work order`));
  }

  it("1 complete: tick + commit + sentinel", async () => {
    const d = deps((cwd) => { tick(cwd, "T-1"); return { tail: "OMH_GOAL_COMPLETE\n" }; });
    expect(await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "M1" }, d)).toBe("complete");
    expect(kinds(repo.dir, "M1")).toEqual(["start", "complete"]);
  }, SLOW);

  it("2 crash-then-sentinel: a failed turn printing the sentinel is an error, the next completes", async () => {
    const d = deps((cwd, i) => {
      if (i === 1) return { status: 1, tail: "boom\nOMH_GOAL_COMPLETE\n" };
      tick(cwd, "T-1");
      return { tail: "OMH_GOAL_COMPLETE\n" };
    });
    expect(await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "M2" }, d)).toBe("complete");
    expect(kinds(repo.dir, "M2")).toEqual(["start", "error", "complete"]);
  }, SLOW);

  it("3 sentinel with tasks still open is ignored and the loop continues", async () => {
    repo = makeRepo(["T-1", "T-2"]);
    const d = deps((cwd, i) => {
      tick(cwd, `T-${i}`);
      return { tail: "OMH_GOAL_COMPLETE\n" };
    });
    expect(await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "M3" }, d)).toBe("complete");
    expect(kinds(repo.dir, "M3")).toEqual(["start", "sentinel-ignored", "progress", "complete"]);
  }, SLOW);

  it("4 usage limit without progress backs off by limitBackoff", async () => {
    repo = makeRepo(["T-1"], { limitBackoff: 33 });
    const d = deps((cwd, i) => {
      if (i === 1) return { tail: "Usage limit reached. Resets at 3pm.\n" };
      tick(cwd, "T-1");
      return { tail: "OMH_GOAL_COMPLETE\n" };
    });
    await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "M4" }, d);
    expect(kinds(repo.dir, "M4")).toEqual(["start", "limit", "complete"]);
    expect(d.sleeps).toEqual([33_000]);
  }, SLOW);

  it("5 BLOCKED via the ledger three times reaches the stall backoff", async () => {
    repo = makeRepo(["T-1", "T-2", "T-3", "T-4"], { blockedBackoff: 44, stallStreak: 3 });
    const d = deps((cwd, i) => { blockTask(cwd, `T-${i}`); return { tail: "cannot do this one\n" }; });
    await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "M5", maxIterations: 3 }, d);
    expect(kinds(repo.dir, "M5")).toEqual(["start", "blocked", "blocked", "blocked", "waiting", "stopped"]);
    expect(d.sleeps).toEqual([1000, 1000]);
    // the 3rd turn hit the streak: its wait would have been the backoff
    const waiting = readEvents(repo.dir, "M5").find((e) => e.kind === "waiting");
    expect(waiting?.message).toContain("44s");
  }, SLOW);

  it("6 idle spin (no BLOCKED text at all) reaches the same backoff", async () => {
    repo = makeRepo(["T-1"], { blockedBackoff: 55, stallStreak: 3 });
    const d = deps(() => ({ tail: "thinking about it\n" }));
    await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "M6", maxIterations: 4 }, d);
    expect(kinds(repo.dir, "M6")).toEqual(["start", "idle", "idle", "idle", "waiting", "idle", "waiting", "stopped"]);
    expect(d.sleeps).toEqual([1000, 1000, 55_000]);
  }, SLOW);

  it("7 a stop requested during a long turn ends the run as stopped", async () => {
    repo = makeRepo(["T-1", "T-2"]);
    const d = deps((cwd, _i, o) => {
      fs.writeFileSync(loopPaths(repo.dir).stopFlag, "");
      expect(o.shouldStop()).toBe(true);
      return { status: null, signal: "SIGTERM" as const, stoppedByRequest: true, tail: "partial" };
    });
    expect(await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "M7" }, d)).toBe("stopped");
    expect(kinds(repo.dir, "M7")).toEqual(["start", "error", "stopped"]);
  }, SLOW);

  it("8 two supervisors on one project: exactly one runs", async () => {
    const d = deps(async (cwd) => { await new Promise((r) => setTimeout(r, 300)); tick(cwd, "T-1"); return { tail: "OMH_GOAL_COMPLETE\n" }; });
    const ps = () => `omh loop run --run-id A`;
    const [a, b] = await Promise.all([
      runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "A", psArgs: ps }, d),
      runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "B", psArgs: ps }, d),
    ]);
    expect([a, b].sort()).toEqual(["already-running", "complete"]);
    expect(d.iterations).toBe(1);
  }, SLOW);

  it("9 a stale run.json from a dead runner is reclaimed", async () => {
    const p = loopPaths(repo.dir);
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(p.runJson, JSON.stringify({ runId: "DEAD", pid: 999999, startedAt: "", runtime: "claude", iteration: 3, cwd: repo.dir }));
    const d = deps((cwd) => { tick(cwd, "T-1"); return { tail: "OMH_GOAL_COMPLETE\n" }; });
    expect(await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "M9" }, d)).toBe("complete");
    expect(kinds(repo.dir, "M9")[0]).toBe("start");
  }, SLOW);

  it("10 disabling the loop (generate with loop off) after a run removes run state and the worktree", async () => {
    repo = makeRepo(["T-1", "T-2"], { isolate: true });
    const d = deps((cwd) => { tick(cwd, "T-1"); return { tail: "one\n" }; });
    await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "M10", maxIterations: 1 }, d);
    const wt = loopPaths(repo.dir).worktree;
    expect(fs.existsSync(wt)).toBe(true);
    const { generate } = await import("../../src/core/generator.js");
    const { harnessToMergedConfigV2 } = await import("../../src/core/harness-converter-v2.js");
    const off = await harnessToMergedConfigV2(HarnessConfigSchema.parse({ version: "1.0", loop: { enabled: false } }), undefined, repo.dir);
    await generate({ projectDir: repo.dir, config: off });
    expect(readRun(repo.dir)).toBeNull();
    expect(fs.existsSync(wt)).toBe(false);
  }, SLOW);

  it("11 isolate: seeds once, keeps the loop's ticks on restart, reseeds on a new goal", async () => {
    repo = makeRepo(["T-1", "T-2"], { isolate: true });
    const wt = loopPaths(repo.dir).worktree;
    // run 1: tick T-1 in the worktree, then stop
    const d1 = deps((cwd) => { expect(cwd).toBe(wt); tick(cwd, "T-1"); return { tail: "one\n" }; });
    await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "S1", maxIterations: 1 }, d1);
    expect(kinds(repo.dir, "S1")).toEqual(["seeded", "start", "progress", "stopped"]);
    expect(fs.readFileSync(path.join(wt, "WORKPLAN.md"), "utf-8")).toContain("- [x] T-1");
    // run 2: same main ledger → the worktree copy (with T-1 ticked) is kept
    const d2 = deps((cwd) => { expect(fs.readFileSync(path.join(cwd, "WORKPLAN.md"), "utf-8")).toContain("- [x] T-1"); return { tail: "" }; });
    await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "S2", maxIterations: 1 }, d2);
    expect(kinds(repo.dir, "S2")).not.toContain("seeded");
    // run 3: a new goal in the main tree → reseeded
    fs.writeFileSync(path.join(repo.dir, "WORKPLAN.md"), "- [ ] N-1\n");
    const d3 = deps((cwd) => { expect(fs.readFileSync(path.join(cwd, "WORKPLAN.md"), "utf-8")).toBe("- [ ] N-1\n"); return { tail: "" }; });
    await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "S3", maxIterations: 1 }, d3);
    expect(kinds(repo.dir, "S3")).toContain("seeded");
  }, SLOW);

  it("12 a runtime that echoes the prompt (with its BLOCKED: literal) never registers as blocked", async () => {
    const { renderPrompt } = await import("../../src/loop/protocol.js");
    const d = deps(() => ({ tail: renderPrompt(repo.cfg) + "\nworking on it\n" }));
    await runSupervisor({ projectDir: repo.dir, cfg: repo.cfg, runId: "M12", maxIterations: 2 }, d);
    const k = kinds(repo.dir, "M12");
    expect(k.filter((x) => x === "blocked")).toHaveLength(0);
    expect(k).toEqual(["start", "idle", "idle", "stopped"]);
  }, SLOW);
});
