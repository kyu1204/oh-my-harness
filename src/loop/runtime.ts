import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * One headless turn of the agent runtime.
 *
 * The runtime is spawned from an argv array — never through a shell — so no
 * value from harness.yaml is ever interpolated into shell text. It is NOT
 * detached: it stays in the supervisor's process group, which is what lets
 * `omh loop stop` take the whole tree down with one group signal.
 */
export type LoopRuntime = "claude" | "codex" | "pi";

export function buildTurnArgv(runtime: LoopRuntime, model: string, prompt: string): string[] {
  switch (runtime) {
    case "codex":
      return ["codex", "exec", "--model", model, "--dangerously-bypass-approvals-and-sandbox", prompt];
    case "pi":
      return ["pi", "--print", "--no-session", "--model", model, prompt];
    case "claude":
      return ["claude", "--model", model, "--dangerously-skip-permissions", "-p", prompt];
  }
}

export interface TurnOptions {
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  logPath: string;
  /** Hard backstop: the turn is SIGKILLed when this elapses. */
  timeoutMs: number;
  /** Polled while the turn runs; true asks for a graceful stop. */
  shouldStop: () => boolean;
  pollMs?: number;
  /** How long a SIGTERM gets before SIGKILL. */
  graceMs?: number;
  onSpawn?: (pid: number) => void;
}

export interface TurnResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stoppedByRequest: boolean;
  /** Last few KB of the merged output, for classification and reporting. */
  tail: string;
}

const TAIL_BYTES = 4096;

function readTail(logPath: string): string {
  try {
    const size = fs.statSync(logPath).size;
    const fd = fs.openSync(logPath, "r");
    try {
      const len = Math.min(size, TAIL_BYTES);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      return buf.toString("utf-8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

export function runTurn(o: TurnOptions): Promise<TurnResult> {
  const pollMs = o.pollMs ?? 2000;
  const graceMs = o.graceMs ?? 10_000;
  fs.mkdirSync(path.dirname(o.logPath), { recursive: true });
  const fd = fs.openSync(o.logPath, "a");

  return new Promise((resolve) => {
    let timedOut = false;
    let stoppedByRequest = false;
    let settled = false;
    const timers: NodeJS.Timeout[] = [];

    const finish = (status: number | null, signal: NodeJS.Signals | null, note?: string) => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      clearInterval(poll);
      if (note) fs.writeSync(fd, `${note}\n`);
      fs.closeSync(fd);
      resolve({ status, signal, timedOut, stoppedByRequest, tail: readTail(o.logPath) });
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(o.argv[0], o.argv.slice(1), { cwd: o.cwd, env: o.env, stdio: ["ignore", fd, fd] });
    } catch (err) {
      finish(null, null, `omh-loop: spawn failed: ${(err as Error).message}`);
      return;
    }
    const poll = setInterval(() => {
      if (!o.shouldStop() || stoppedByRequest) return;
      stoppedByRequest = true;
      child.kill("SIGTERM");
      timers.push(setTimeout(() => child.kill("SIGKILL"), graceMs));
    }, pollMs);

    timers.push(
      setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, o.timeoutMs),
    );

    child.once("spawn", () => {
      if (child.pid !== undefined) o.onSpawn?.(child.pid);
    });
    // ENOENT and friends arrive here rather than as a throw; the turn is
    // reported as failed with the reason in the log, and the loop goes on.
    child.once("error", (err) => finish(null, null, `omh-loop: ${(err as NodeJS.ErrnoException).code ?? ""} ${err.message}`));
    child.once("exit", (status, signal) => finish(status, signal));
  });
}
