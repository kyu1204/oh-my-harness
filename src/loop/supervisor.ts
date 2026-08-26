import fs from "node:fs";
import path from "node:path";
import type { LoopConfig } from "../core/merged-config.js";
import { parseLedger } from "./ledger.js";
import { classifyTurn, waitFor } from "./classify.js";
import type { TurnKind } from "./classify.js";
import { buildTurnArgv, runTurn as realRunTurn } from "./runtime.js";
import type { TurnOptions, TurnResult } from "./runtime.js";
import { renderPrompt } from "./protocol.js";
import {
  loopPaths,
  acquireRun,
  updateRun,
  releaseRun,
  appendEvent,
  turnLogPath,
} from "./state.js";
import type { LivenessDeps } from "./state.js";
import { ensureWorktree, syncAssets, seedLedger, headOf, WorktreeError } from "./worktree.js";

/**
 * One run of the autonomous loop, start to finish:
 * acquire the run lock → enter the worktree and seed the ledger → loop
 * { stop flag? → sync architect assets → snapshot → turn → classify →
 * event → wait } → release.
 *
 * Only `runTurn` and `sleep` are injectable; everything else (fs, git) is
 * real, because a temp git repo is cheap and the bash version's defects were
 * precisely the ones a fake would have hidden.
 */
export interface SupervisorDeps {
  runTurn: (o: TurnOptions) => Promise<TurnResult>;
  sleep: (ms: number) => Promise<void>;
}

export interface SupervisorOptions extends LivenessDeps {
  projectDir: string;
  cfg: LoopConfig;
  runId: string;
  /** Backstop for tests and bounded runs; the loop stops after this many turns. */
  maxIterations?: number;
}

export type SupervisorExit = "complete" | "stopped" | "already-running" | "failed";

export const defaultDeps: SupervisorDeps = {
  runTurn: realRunTurn,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export async function runSupervisor(o: SupervisorOptions, deps: SupervisorDeps = defaultDeps): Promise<SupervisorExit> {
  const { projectDir, cfg, runId } = o;
  const p = loopPaths(projectDir);
  const event = (kind: string, extra: { iteration?: number; message?: string; meta?: Record<string, unknown> } = {}) =>
    appendEvent(projectDir, { runId, kind, ...extra });

  const acquired = acquireRun(
    projectDir,
    { runId, pid: process.pid, startedAt: new Date().toISOString(), runtime: cfg.runtime, iteration: 0, cwd: projectDir },
    { psArgs: o.psArgs },
  );
  if (!acquired) {
    event("already-running", { message: "another runner holds run.json" });
    return "already-running";
  }

  let childPid: number | undefined;
  let lastTurnPid: number | undefined;
  const onSignal = () => {
    // Synchronous only: we are inside a signal handler.
    if (childPid !== undefined) {
      try {
        process.kill(-childPid, "SIGTERM"); // the turn's own process group
      } catch {
        try {
          process.kill(childPid, "SIGTERM");
        } catch {
          // already gone
        }
      }
    }
    event("stopped", { message: "signal" });
    releaseRun(projectDir, runId);
    process.exit(143);
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);

  try {
    let cwd = projectDir;
    if (cfg.isolate) {
      try {
        const wt = await ensureWorktree(projectDir);
        cwd = wt.path;
        if (wt.reusedBranch) event("worktree-reused", { message: `checked out existing ${p.branch}` });
        const seed = await seedLedger(projectDir, cwd, cfg.ledger);
        if (seed.seeded) event("seeded", { meta: { ledgerHash: seed.hash } });
      } catch (err) {
        event("failed", { message: (err as Error).message });
        return "failed";
      }
      updateRun(projectDir, runId, { cwd });
    }

    event("start", { meta: { runtime: cfg.runtime, model: cfg.model, cwd } });
    const prompt = renderPrompt(cfg);
    const ledgerPath = path.join(cwd, cfg.ledger);
    let streak = 0;
    let iteration = 0;

    while (true) {
      if (fs.existsSync(p.stopFlag)) {
        event("stopped", { iteration, message: "stop flag" });
        return "stopped";
      }
      if (cfg.isolate) {
        try {
          await syncAssets(projectDir, cwd, cfg.workOrders);
        } catch (err) {
          event("failed", { iteration, message: (err as WorktreeError).message });
          return "failed";
        }
      }

      const ledgerBefore = parseLedger(readOr(ledgerPath));
      let headBefore: string;
      try {
        headBefore = await headOf(cwd);
      } catch (err) {
        event("failed", { iteration, message: `git failed: ${(err as Error).message}` });
        return "failed";
      }
      iteration++;
      updateRun(projectDir, runId, { iteration });

      const result = await deps.runTurn({
        argv: buildTurnArgv(cfg.runtime, cfg.model, prompt),
        cwd,
        env: { ...process.env, OMH_LOOP: "1", OMH_LOOP_RUN_ID: runId },
        logPath: turnLogPath(p, runId, iteration),
        timeoutMs: cfg.turnTimeout * 1000,
        shouldStop: () => fs.existsSync(p.stopFlag),
        onSpawn: (pid) => {
          childPid = pid;
          lastTurnPid = pid;
          updateRun(projectDir, runId, { childPid: pid });
        },
      });
      childPid = undefined;
      // Drop the pid from the record too: a stale childPid outlives pid reuse
      // and would let a later stop signal an unrelated process group.
      updateRun(projectDir, runId, { childPid: undefined });

      const ledgerAfter = parseLedger(readOr(ledgerPath));
      let headAfter: string;
      try {
        headAfter = await headOf(cwd);
      } catch (err) {
        event("failed", { iteration, message: `git failed after the turn: ${(err as Error).message}` });
        return "failed";
      }
      const c = classifyTurn({
        status: result.status,
        signal: result.signal,
        timedOut: result.timedOut,
        tail: result.tail,
        sentinel: cfg.sentinel,
        ledgerBefore,
        ledgerAfter,
        headBefore,
        headAfter,
      });
      if (c.sentinelIgnored) {
        event("sentinel-ignored", { iteration, message: `${ledgerAfter.unchecked} task(s) still open` });
      }
      event(c.kind, {
        iteration,
        meta: {
          status: result.status,
          signal: result.signal,
          ticked: ledgerAfter.checked - ledgerBefore.checked,
          newBlocked: ledgerAfter.blocked - ledgerBefore.blocked,
          head: headAfter,
        },
      });

      if (c.kind === "complete") return "complete";
      if (result.stoppedByRequest) {
        event("stopped", { iteration, message: "stop requested during turn" });
        return "stopped";
      }

      streak = isStall(c.kind) ? streak + 1 : 0;
      const waitMs = waitFor(c.kind, streak, cfg);
      if (isStall(c.kind) && streak >= cfg.stallStreak) {
        event("waiting", { iteration, message: `${streak} stalled turns in a row — backing off ${waitMs / 1000}s` });
      }
      if (o.maxIterations !== undefined && iteration >= o.maxIterations) {
        event("stopped", { iteration, message: "max iterations" });
        return "stopped";
      }
      await deps.sleep(waitMs);
    }
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
    // Each turn runs in its own session, so sweepOwnGroup cannot reach its
    // descendants; a TERM-ignoring daemon (codex parks one) gets a hard
    // sweep of the last turn's group here instead.
    if (lastTurnPid !== undefined) {
      try {
        process.kill(-lastTurnPid, "SIGKILL");
      } catch {
        // group already gone
      }
    }
    releaseRun(projectDir, runId);
  }
}

function isStall(kind: TurnKind): boolean {
  return kind === "blocked" || kind === "idle" || kind === "error";
}

function readOr(file: string): string {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return "";
  }
}
