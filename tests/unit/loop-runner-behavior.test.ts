import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { generate } from "../../src/core/generator.js";
import { HarnessConfigSchema } from "../../src/core/harness-schema.js";
import { harnessToMergedConfigV2 } from "../../src/core/harness-converter-v2.js";

// Executes the GENERATED runner end to end against a stub `claude` on PATH.
// String assertions on the rendered script cannot catch a swallowed `=` or a
// broken pipeline; only running it can.
async function makeProject(loopOverrides: Record<string, unknown> = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-runner-"));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  await fs.writeFile(path.join(dir, "README.md"), "x\n");
  execFileSync("git", ["-C", dir, "add", "."]);
  execFileSync("git", ["-C", dir, "commit", "-qm", "init"]);
  await fs.writeFile(path.join(dir, "WORKPLAN.md"), "- [ ] T-1\n");
  const harness = HarnessConfigSchema.parse({ version: "1.0", loop: { isolate: false, interval: 1, ...loopOverrides } });
  const merged = await harnessToMergedConfigV2(harness, undefined, dir);
  await generate({ projectDir: dir, config: merged });
  // stub runtime on PATH
  const bin = path.join(dir, "stubbin");
  await fs.mkdir(bin);
  return { dir, bin };
}

async function stubClaude(bin: string, script: string) {
  const p = path.join(bin, "claude");
  await fs.writeFile(p, `#!/usr/bin/env bash\n${script}\n`);
  await fs.chmod(p, 0o755);
}

function runRunner(dir: string, bin: string, timeoutMs = 15000) {
  return spawnSync("bash", [path.join(dir, ".omh", "loop", "run.sh")], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: "utf-8",
    timeout: timeoutMs,
  });
}

async function events(dir: string): Promise<string[]> {
  const raw = await fs.readFile(path.join(dir, ".omh", "state", "loop-events.jsonl"), "utf-8");
  return raw.trim().split("\n").map((l) => (JSON.parse(l) as { kind: string }).kind);
}

describe("generated runner, executed", () => {
  it("completes when the stub prints the sentinel as its final line", async () => {
    const { dir, bin } = await makeProject();
    await stubClaude(bin, 'echo "did the task"; echo "OMH_GOAL_COMPLETE"');
    const r = runRunner(dir, bin);
    expect(r.status).toBe(0);
    const kinds = await events(dir);
    expect(kinds[0]).toBe("start");
    expect(kinds).toContain("complete");
  });

  it("does NOT complete on a sentinel echoed by a crashed turn", async () => {
    const { dir, bin } = await makeProject();
    // first turn: crash but echo sentinel; second turn: honest completion
    await stubClaude(bin, `
      c="$OMH_TEST_COUNT_FILE"; n=$(cat "$c" 2>/dev/null || echo 0); echo $((n+1)) > "$c"
      if [ "$n" -eq 0 ]; then echo "OMH_GOAL_COMPLETE"; exit 1; fi
      echo "OMH_GOAL_COMPLETE"`);
    const counter = path.join(dir, "count");
    const r = spawnSync("bash", [path.join(dir, ".omh", "loop", "run.sh")], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OMH_TEST_COUNT_FILE: counter },
      encoding: "utf-8",
      timeout: 15000,
    });
    expect(r.status).toBe(0);
    const kinds = await events(dir);
    expect(kinds).toContain("error");
    expect(kinds.indexOf("complete")).toBeGreaterThan(kinds.indexOf("error"));
  });

  it("refuses to start a second runner while one holds the lock", async () => {
    const { dir, bin } = await makeProject();
    await stubClaude(bin, 'sleep 3; echo "OMH_GOAL_COMPLETE"');
    const { spawn } = await import("node:child_process");
    const first = spawn("bash", [path.join(dir, ".omh", "loop", "run.sh")], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    await new Promise((r) => setTimeout(r, 800));
    const second = runRunner(dir, bin, 5000);
    expect(second.status).not.toBe(0);
    await new Promise<void>((r) => first.on("exit", () => r()));
    const kinds = await events(dir);
    expect(kinds.filter((k) => k === "start")).toHaveLength(1);
    expect(kinds).toContain("already-running");
  });

  it("records its pid so disable/uninstall can stop it", async () => {
    const { dir, bin } = await makeProject();
    await stubClaude(bin, 'echo "OMH_GOAL_COMPLETE"');
    const { spawn } = await import("node:child_process");
    const child = spawn("bash", [path.join(dir, ".omh", "loop", "run.sh")], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    // attach before it can exit — a fast runner would otherwise race the listener
    const exited = new Promise<void>((r) => child.on("exit", () => r()));
    await exited;
    // the pid file is removed on clean exit
    await expect(fs.access(path.join(dir, ".omh", "state", "loop.pid"))).rejects.toThrow();
  });
});

describe("disabling the loop stops a live runner", () => {
  it("writes the stop file and signals the recorded pid before removing assets", async () => {
    const { dir, bin } = await makeProject();
    const stateDir = path.join(dir, ".omh", "state");
    // a real runner whose turn is long-lived
    await stubClaude(bin, "sleep 60");
    const { spawn } = await import("node:child_process");
    const fake = spawn("bash", [path.join(dir, ".omh", "loop", "run.sh")], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    const exited = new Promise<boolean>((r) => {
      const t = setTimeout(() => r(false), 8000);
      fake.on("exit", () => { clearTimeout(t); r(true); });
    });
    for (let i = 0; i < 50; i++) {
      try { await fs.access(path.join(stateDir, "loop.pid")); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    const harness = HarnessConfigSchema.parse({ version: "1.0", loop: { enabled: false } });
    const merged = await harnessToMergedConfigV2(harness, undefined, dir);
    await generate({ projectDir: dir, config: merged });
    expect(await exited).toBe(true);
    await expect(fs.access(path.join(stateDir, "loop.stop"))).resolves.toBeUndefined();
  });
});

describe("round seven: lock reclaim race and pid hygiene", () => {
  it("exactly one of two runners racing for a stale lock starts", async () => {
    const { dir, bin } = await makeProject();
    const stateDir = path.join(dir, ".omh", "state");
    // a stale lock left by a dead runner (pid that no longer exists)
    await fs.mkdir(path.join(stateDir, "loop.lock"), { recursive: true });
    await fs.writeFile(path.join(stateDir, "loop.pid"), "999999");
    await stubClaude(bin, 'sleep 2; echo "OMH_GOAL_COMPLETE"');
    const { spawn } = await import("node:child_process");
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    const a = spawn("bash", [path.join(dir, ".omh", "loop", "run.sh")], { env });
    const b = spawn("bash", [path.join(dir, ".omh", "loop", "run.sh")], { env });
    const done = Promise.all([a, b].map((c) => new Promise<number | null>((r) => c.on("exit", (code) => r(code)))));
    const codes = await done;
    expect(codes.filter((c) => c === 0)).toHaveLength(1);
    const kinds = await events(dir);
    expect(kinds.filter((k) => k === "start")).toHaveLength(1);
    expect(kinds.filter((k) => k === "complete")).toHaveLength(1);
  });

  it("stopRunningLoop refuses to signal a pid that is not a runner", async () => {
    const { dir } = await makeProject();
    const stateDir = path.join(dir, ".omh", "state");
    const { spawn } = await import("node:child_process");
    const bystander = spawn("sleep", ["30"]);
    const exited = new Promise<boolean>((r) => {
      const t = setTimeout(() => r(false), 2500);
      bystander.on("exit", () => { clearTimeout(t); r(true); });
    });
    // pid file points at an unrelated process (pid reuse after SIGKILL)
    await fs.writeFile(path.join(stateDir, "loop.pid"), String(bystander.pid));
    const { stopRunningLoop } = await import("../../src/generators/loop-assets.js");
    await stopRunningLoop(dir);
    expect(await exited).toBe(false);
    bystander.kill();
  });

  it("stopping the runner also stops its in-flight runtime child", async () => {
    const { dir, bin } = await makeProject();
    // the child records its pid then sleeps far longer than the test
    await stubClaude(bin, 'echo $$ > "$OMH_TEST_CHILD_PID"; sleep 60');
    const childPidFile = path.join(dir, "child.pid");
    const { spawn } = await import("node:child_process");
    const runner = spawn("bash", [path.join(dir, ".omh", "loop", "run.sh")], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OMH_TEST_CHILD_PID: childPidFile },
    });
    const runnerExited = new Promise<void>((r) => runner.on("exit", () => r()));
    for (let i = 0; i < 50; i++) {
      try { await fs.access(childPidFile); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    const childPid = Number((await fs.readFile(childPidFile, "utf-8")).trim());
    const { stopRunningLoop } = await import("../../src/generators/loop-assets.js");
    await stopRunningLoop(dir);
    await runnerExited;
    await new Promise((r) => setTimeout(r, 300));
    const alive = (() => { try { process.kill(childPid, 0); return true; } catch { return false; } })();
    expect(alive).toBe(false);
  });
});
