import { describe, it, expect, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { buildTurnArgv, runTurn } from "../../src/loop/runtime.js";

const SLOW = 15_000;
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "omh-runtime-"));
});

function stub(script: string): string {
  const p = path.join(dir, "stub.sh");
  fs.writeFileSync(p, `#!/usr/bin/env bash\n${script}\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

describe("buildTurnArgv", () => {
  it("builds the exact argv for each runtime, prompt as a positional (no shell)", () => {
    expect(buildTurnArgv("claude", "sonnet", "P")).toEqual([
      "claude", "--model", "sonnet", "--dangerously-skip-permissions", "-p", "P",
    ]);
    expect(buildTurnArgv("codex", "gpt-5.5-mini", "P")).toEqual([
      // Codex skips untrusted project hooks unless trust is bypassed; an
      // unattended loop cannot answer a trust prompt.
      "codex", "exec", "--model", "gpt-5.5-mini", "--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust", "P",
    ]);
    expect(buildTurnArgv("pi", "google/gemini-2.5-flash", "P")).toEqual([
      "pi", "--print", "--no-session", "--model", "google/gemini-2.5-flash", "P",
    ]);
  });
});

describe("runTurn", () => {
  it("captures exit status and both streams into the log and the tail", async () => {
    const logPath = path.join(dir, "turn.log");
    const r = await runTurn({
      argv: [stub('echo out; echo err >&2; exit 3')],
      cwd: dir, env: process.env, logPath, timeoutMs: 5000, shouldStop: () => false,
    });
    expect(r.status).toBe(3);
    expect(r.timedOut).toBe(false);
    expect(r.stoppedByRequest).toBe(false);
    expect(r.tail).toContain("out");
    expect(r.tail).toContain("err");
    expect(fs.readFileSync(logPath, "utf-8")).toContain("out");
  }, SLOW);

  it("kills a turn that exceeds the timeout", async () => {
    const started = Date.now();
    const r = await runTurn({
      argv: [stub("sleep 30")],
      cwd: dir, env: process.env, logPath: path.join(dir, "t.log"), timeoutMs: 500, shouldStop: () => false,
    });
    expect(r.timedOut).toBe(true);
    expect(r.signal).toBe("SIGKILL");
    expect(Date.now() - started).toBeLessThan(3000);
  }, SLOW);

  it("escalates SIGTERM to SIGKILL when a stop is requested and the child ignores TERM", async () => {
    // The stub signals readiness only after its trap is installed; asking for
    // a stop before that would TERM a bash that has not yet ignored TERM.
    const ready = path.join(dir, "ready");
    const started = Date.now();
    const r = await runTurn({
      argv: [stub(`trap '' TERM; touch '${ready}'; sleep 30`)],
      cwd: dir, env: process.env, logPath: path.join(dir, "s.log"), timeoutMs: 20_000,
      shouldStop: () => fs.existsSync(ready), pollMs: 100, graceMs: 200,
    });
    expect(r.stoppedByRequest).toBe(true);
    expect(r.signal).toBe("SIGKILL");
    expect(Date.now() - started).toBeLessThan(3000);
  }, SLOW);

  it("reports a missing binary as a result, not a rejection", async () => {
    const r = await runTurn({
      argv: [path.join(dir, "no-such-binary")],
      cwd: dir, env: process.env, logPath: path.join(dir, "m.log"), timeoutMs: 5000, shouldStop: () => false,
    });
    expect(r.status).toBeNull();
    expect(r.tail).toContain("ENOENT");
  }, SLOW);

  it("reports the child pid through onSpawn", async () => {
    let pid = 0;
    await runTurn({
      argv: [stub("exit 0")],
      cwd: dir, env: process.env, logPath: path.join(dir, "p.log"), timeoutMs: 5000,
      shouldStop: () => false, onSpawn: (p) => { pid = p; },
    });
    expect(pid).toBeGreaterThan(0);
  }, SLOW);
});

describe("runTurn — review round 9", () => {
  it("resolves (never rejects) when spawn itself throws synchronously", async () => {
    // an empty command makes spawn throw ERR_INVALID_ARG_VALUE before any 'error' event
    const r = await runTurn({
      argv: [""], cwd: dir, env: process.env, logPath: path.join(dir, "bad.log"), timeoutMs: 5000, shouldStop: () => false,
    });
    expect(r.status).toBeNull();
    expect(r.tail).toMatch(/spawn failed|ERR_INVALID_ARG/);
  }, SLOW);

  it("timeout takes the turn's whole process tree down, not just the direct child", async () => {
    const pidFile = path.join(dir, "grandchild.pid");
    const r = await runTurn({
      argv: [stub(`sleep 30 & echo $! > '${pidFile}'; wait`)],
      cwd: dir, env: process.env, logPath: path.join(dir, "tree.log"), timeoutMs: 700, shouldStop: () => false,
    });
    expect(r.timedOut).toBe(true);
    const gc = Number(fs.readFileSync(pidFile, "utf-8").trim());
    const gone = async () => { for (let i = 0; i < 40; i++) { try { process.kill(gc, 0); } catch { return true; } await new Promise((res) => setTimeout(res, 50)); } return false; };
    expect(await gone(), "grandchild survived the timeout").toBe(true);
  }, SLOW);

  it("a stop request takes the turn's whole process tree down too", async () => {
    const pidFile = path.join(dir, "grandchild2.pid");
    const r = await runTurn({
      argv: [stub(`sleep 30 & echo $! > '${pidFile}'; wait`)],
      cwd: dir, env: process.env, logPath: path.join(dir, "tree2.log"), timeoutMs: 20_000,
      shouldStop: () => fs.existsSync(pidFile), pollMs: 100, graceMs: 300,
    });
    expect(r.stoppedByRequest).toBe(true);
    const gc = Number(fs.readFileSync(pidFile, "utf-8").trim());
    const gone = async () => { for (let i = 0; i < 40; i++) { try { process.kill(gc, 0); } catch { return true; } await new Promise((res) => setTimeout(res, 50)); } return false; };
    expect(await gone(), "grandchild survived the stop").toBe(true);
  }, SLOW);
});
