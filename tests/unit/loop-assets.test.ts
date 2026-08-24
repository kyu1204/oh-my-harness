import { describe, it, expect } from "vitest";
import path from "node:path";
import { computeLoopAssets } from "../../src/generators/loop-assets.js";
import type { MergedConfig } from "../../src/core/merged-config.js";
import type { LoopConfig } from "../../src/core/merged-config.js";

const PROJECT_DIR = "/tmp/omh-loop-fixture";

function baseConfig(loop?: LoopConfig): MergedConfig {
  return {
    presets: [],
    variables: {},
    claudeMdSections: [],
    hooks: {
      preToolUse: [],
      postToolUse: [],
      sessionStart: [],
      notification: [],
      configChange: [],
      worktreeCreate: [],
    },
    settings: { permissions: { allow: [], deny: [] } },
    loop,
  };
}

const LOOP: LoopConfig = {
  ledger: "WORKPLAN.md",
  workOrders: "docs/work-orders",
  model: "sonnet",
  sentinel: "OMH_GOAL_COMPLETE",
  interval: 120,
  blockedBackoff: 1800,
  architectOnly: [],
  isolate: true,
  runtime: "claude",
};

describe("computeLoopAssets", () => {
  it("emits nothing when the loop engine is not configured", async () => {
    const files = await computeLoopAssets({ projectDir: PROJECT_DIR, config: baseConfig() });
    expect(files).toEqual([]);
  });

  it("emits the runner script as an executable file under .omh/loop", async () => {
    const files = await computeLoopAssets({ projectDir: PROJECT_DIR, config: baseConfig(LOOP) });
    const runner = files.find((f) => f.path === path.join(PROJECT_DIR, ".omh", "loop", "run.sh"));
    expect(runner).toBeDefined();
    expect(runner?.chmod).toBe(0o755);
  });

  it("bakes the configured sentinel, model and backoffs into the runner", async () => {
    const files = await computeLoopAssets({ projectDir: PROJECT_DIR, config: baseConfig(LOOP) });
    const runner = files.find((f) => f.path.endsWith("run.sh"));
    expect(runner?.content).toContain("OMH_GOAL_COMPLETE");
    expect(runner?.content).toContain("OMH_LOOP_MODEL='sonnet'");
    expect(runner?.content).toContain("OMH_LOOP_INTERVAL=120");
    expect(runner?.content).toContain("OMH_LOOP_BLOCKED_BACKOFF=1800");
  });

  it("matches the sentinel as a whole line only, never a substring", async () => {
    const files = await computeLoopAssets({ projectDir: PROJECT_DIR, config: baseConfig(LOOP) });
    const runner = files.find((f) => f.path.endsWith("run.sh"));
    // grep -q would match the model merely *mentioning* the sentinel; -qx does not.
    expect(runner?.content).toMatch(/grep\s+-qx/);
    expect(runner?.content).not.toMatch(/grep\s+-q\s+"?\$\{?SENTINEL/);
  });

  it("keeps the three backoff conditions separate (limit, empty-output, blocked)", async () => {
    const files = await computeLoopAssets({ projectDir: PROJECT_DIR, config: baseConfig(LOOP) });
    const content = files.find((f) => f.path.endsWith("run.sh"))?.content ?? "";
    expect(content).toMatch(/usage limit/i);
    expect(content).toContain("OMH_LOOP_EMPTY_BACKOFF");
    expect(content).toContain("OMH_LOOP_BLOCKED_BACKOFF");
  });

  it("never leaves the model unspecified, so the loop cannot fall back to the top tier", async () => {
    const files = await computeLoopAssets({
      projectDir: PROJECT_DIR,
      config: baseConfig({ ...LOOP, model: "haiku" }),
    });
    const content = files.find((f) => f.path.endsWith("run.sh"))?.content ?? "";
    expect(content).toContain("OMH_LOOP_MODEL='haiku'");
  });

  it("dispatches on runtime so codex and pi sessions can drive the same loop", async () => {
    const files = await computeLoopAssets({
      projectDir: PROJECT_DIR,
      config: baseConfig({ ...LOOP, runtime: "codex" }),
    });
    const content = files.find((f) => f.path.endsWith("run.sh"))?.content ?? "";
    expect(content).toContain("OMH_LOOP_RUNTIME=codex");
  });

  it("appends loop events to .omh/state so monitoring never depends on the runtime", async () => {
    const files = await computeLoopAssets({ projectDir: PROJECT_DIR, config: baseConfig(LOOP) });
    const content = files.find((f) => f.path.endsWith("run.sh"))?.content ?? "";
    expect(content).toContain('EVENTS="$STATE_DIR/loop-events.jsonl"');
    expect(content).toContain(".omh/state");
  });
});

describe("loop assets in the generator pipeline", () => {
  it("planGenerate includes the runner so sync --check and diff see loop drift", async () => {
    const { planGenerate } = await import("../../src/core/generator.js");
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-loop-plan-"));
    const plan = await planGenerate({ projectDir: dir, config: baseConfig(LOOP) });
    const runner = plan.files.find((f) => f.path === path.join(dir, ".omh", "loop", "run.sh"));
    expect(runner).toBeDefined();
    expect(runner?.chmod).toBe(0o755);
  });

  it("generate writes the runner to disk as executable", async () => {
    const { generate } = await import("../../src/core/generator.js");
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-loop-gen-"));
    const result = await generate({ projectDir: dir, config: baseConfig(LOOP) });
    const runnerPath = path.join(dir, ".omh", "loop", "run.sh");
    expect(result.files).toContain(runnerPath);
    const stat = await fs.stat(runnerPath);
    expect(stat.mode & 0o111).toBeTruthy();
  });

  it("emits no loop files when the loop engine is not configured", async () => {
    const { planGenerate } = await import("../../src/core/generator.js");
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-loop-off-"));
    const plan = await planGenerate({ projectDir: dir, config: baseConfig() });
    expect(plan.files.some((f) => f.path.includes("/loop/"))).toBe(false);
  });
});

describe("loop skill", () => {
  it("emits a Claude skill that routes a loop request to the setup steps", async () => {
    const files = await computeLoopAssets({ projectDir: PROJECT_DIR, config: baseConfig(LOOP) });
    const skill = files.find((f) => f.path === path.join(PROJECT_DIR, ".claude", "skills", "omh-loop", "SKILL.md"));
    expect(skill).toBeDefined();
    expect(skill?.content).toContain("WORKPLAN.md");
    expect(skill?.content).toContain("docs/work-orders");
    expect(skill?.content).toContain(".omh/loop/run.sh");
    // Monitoring must be attached at start-up, not polled when someone asks.
    expect(skill?.content).toContain("tail -f");
  });
});

describe("runner fixes from deep review", () => {
  it("clears a leftover stop file at startup so the loop can be restarted", async () => {
    const files = await computeLoopAssets({ projectDir: PROJECT_DIR, config: baseConfig(LOOP) });
    const content = files.find((f) => f.path.endsWith("run.sh"))?.content ?? "";
    expect(content).toContain('rm -f "$STOP_FILE"');
  });

  it("counts only 'BLOCKED:' markers, not turns that merely mention the word", async () => {
    const files = await computeLoopAssets({ projectDir: PROJECT_DIR, config: baseConfig(LOOP) });
    const content = files.find((f) => f.path.endsWith("run.sh"))?.content ?? "";
    expect(content).toContain('grep -q "BLOCKED:"');
    expect(content).not.toMatch(/grep -q "BLOCKED"(?!:)/);
  });

  it("drives the model from the single OMH_LOOP_MODEL variable", async () => {
    const files = await computeLoopAssets({ projectDir: PROJECT_DIR, config: baseConfig(LOOP) });
    const content = files.find((f) => f.path.endsWith("run.sh"))?.content ?? "";
    expect(content).toContain('--model "$OMH_LOOP_MODEL"');
  });

  it("emits events via node, the one interpreter an npm CLI can rely on", async () => {
    const files = await computeLoopAssets({ projectDir: PROJECT_DIR, config: baseConfig(LOOP) });
    const content = files.find((f) => f.path.endsWith("run.sh"))?.content ?? "";
    expect(content).not.toContain("python3");
    expect(content).toContain("node");
  });

  it("isolates into a git worktree when isolate is on", async () => {
    const files = await computeLoopAssets({ projectDir: PROJECT_DIR, config: baseConfig(LOOP) });
    const content = files.find((f) => f.path.endsWith("run.sh"))?.content ?? "";
    expect(content).toContain("git worktree add");
    expect(content).toContain("omh-loop");
  });

  it("skips the worktree when isolate is off", async () => {
    const files = await computeLoopAssets({ projectDir: PROJECT_DIR, config: baseConfig({ ...LOOP, isolate: false }) });
    const content = files.find((f) => f.path.endsWith("run.sh"))?.content ?? "";
    expect(content).not.toContain("git worktree add");
  });

  it("tells the architect to start the runner in the background, never foreground", async () => {
    const files = await computeLoopAssets({ projectDir: PROJECT_DIR, config: baseConfig(LOOP) });
    const skill = files.find((f) => f.path.endsWith("SKILL.md"))?.content ?? "";
    expect(skill).toContain("nohup");
  });
});

describe("generated runner is valid shell", () => {
  it("passes bash -n", async () => {
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const { execFileSync } = await import("node:child_process");
    const files = await computeLoopAssets({ projectDir: PROJECT_DIR, config: baseConfig(LOOP) });
    const runner = files.find((f) => f.path.endsWith("run.sh"))!;
    const tmp = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "omh-loop-sh-")), "run.sh");
    await fs.writeFile(tmp, runner.content, "utf-8");
    expect(() => execFileSync("bash", ["-n", tmp])).not.toThrow();
  });
});

describe("loop worktree hygiene", () => {
  it("gitignores the loop worktree so it never shows up as untracked in the main repo", async () => {
    const { generate } = await import("../../src/core/generator.js");
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-loop-gi-"));
    await generate({ projectDir: dir, config: baseConfig(LOOP) });
    const gitignore = await fs.readFile(path.join(dir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".omh/loop/worktree/");
  });
});
