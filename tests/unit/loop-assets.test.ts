import { describe, it, expect, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { computeLoopAssets, loopAssetPaths } from "../../src/generators/loop-assets.js";
import { renderSkill } from "../../src/loop/protocol.js";
import { generate, planGenerate } from "../../src/core/generator.js";
import { HarnessConfigSchema } from "../../src/core/harness-schema.js";
import { harnessToMergedConfigV2 } from "../../src/core/harness-converter-v2.js";
import type { MergedConfig } from "../../src/core/merged-config.js";
import { loopPaths } from "../../src/loop/state.js";
import { ensureWorktree } from "../../src/loop/worktree.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "omh-assets-"));
});

async function merged(loop: Record<string, unknown> | undefined): Promise<MergedConfig> {
  const harness = HarnessConfigSchema.parse({ version: "1.0", ...(loop ? { loop } : {}) });
  return harnessToMergedConfigV2(harness, undefined, dir);
}

const skillPath = () => path.join(dir, ".claude", "skills", "omh-loop", "SKILL.md");

describe("computeLoopAssets", () => {
  it("emits nothing when the loop is off", async () => {
    expect(await computeLoopAssets({ projectDir: dir, config: await merged({ enabled: false }) })).toEqual([]);
  });

  it("emits exactly one asset — the skill — rendered from protocol.ts", async () => {
    const cfg = await merged({ architectOnly: ["ios/Runner.xcodeproj"] });
    const files = await computeLoopAssets({ projectDir: dir, config: cfg });
    expect(files.map((f) => f.path)).toEqual([skillPath()]);
    expect(files[0].content).toBe(renderSkill(cfg.loop!));
    expect(files[0].content).toContain("ios/Runner.xcodeproj");
  });

  it("never emits a shell runner", async () => {
    const files = await computeLoopAssets({ projectDir: dir, config: await merged({}) });
    expect(files.some((f) => f.path.endsWith("run.sh"))).toBe(false);
  });

  it("loopAssetPaths names the skill directory so a disable removes it whole", () => {
    expect(loopAssetPaths(dir)).toEqual([path.join(dir, ".claude", "skills", "omh-loop")]);
  });
});

describe("generate / planGenerate", () => {
  it("writes the skill and no run.sh; plan and write agree", async () => {
    const cfg = await merged({});
    const plan = await planGenerate({ projectDir: dir, config: cfg });
    expect(plan.files.some((f) => f.path === skillPath())).toBe(true);
    expect(plan.files.some((f) => f.path.includes("/loop/"))).toBe(false);
    const result = await generate({ projectDir: dir, config: cfg });
    expect(result.files).toContain(skillPath());
    expect(fs.existsSync(path.join(dir, ".omh", "loop", "run.sh"))).toBe(false);
    expect(fs.readFileSync(skillPath(), "utf-8")).toBe(renderSkill(cfg.loop!));
  });

  it("gitignores the worktree when isolate is on, in both plan and write", async () => {
    const cfg = await merged({ isolate: true });
    const plan = await planGenerate({ projectDir: dir, config: cfg });
    expect(plan.files.find((f) => f.path.endsWith(".gitignore"))?.content).toContain(".omh/loop/worktree/");
    await generate({ projectDir: dir, config: cfg });
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf-8")).toContain(".omh/loop/worktree/");
  });

  it("disabling the loop removes the skill directory and reports it in wouldDelete first", async () => {
    await generate({ projectDir: dir, config: await merged({}) });
    const off = await merged({ enabled: false });
    const plan = await planGenerate({ projectDir: dir, config: off });
    expect(plan.wouldDelete).toContain(path.join(dir, ".claude", "skills", "omh-loop"));
    await generate({ projectDir: dir, config: off });
    expect(fs.existsSync(path.join(dir, ".claude", "skills", "omh-loop"))).toBe(false);
  });

  it("disabling the loop tears down an existing worktree", async () => {
    execFileSync("git", ["init", "-q", "-b", "main", dir]);
    execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
    fs.writeFileSync(path.join(dir, "README.md"), "x");
    execFileSync("git", ["-C", dir, "add", "."]);
    execFileSync("git", ["-C", dir, "commit", "-qm", "init"]);
    await generate({ projectDir: dir, config: await merged({ isolate: true }) });
    const wt = (await ensureWorktree(dir)).path;
    expect(fs.existsSync(wt)).toBe(true);
    await generate({ projectDir: dir, config: await merged({ enabled: false }) });
    expect(fs.existsSync(wt)).toBe(false);
    expect(fs.existsSync(loopPaths(dir).stopFlag)).toBe(false);
  }, 20_000);
});

describe("legacy cleanup", () => {
  it("planGenerate reports the legacy run.sh in wouldDelete so --check and diff agree with sync", async () => {
    const legacy = path.join(dir, ".omh", "loop", "run.sh");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, "#!/bin/bash\n");
    const plan = await planGenerate({ projectDir: dir, config: await merged({}) });
    expect(plan.wouldDelete).toContain(legacy);
  });

  it("removes a run.sh left behind by the old generated runner on sync", async () => {
    const legacy = path.join(dir, ".omh", "loop", "run.sh");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, "#!/bin/bash\n");
    await generate({ projectDir: dir, config: await merged({}) });
    expect(fs.existsSync(legacy)).toBe(false);
  });
});

describe("disable protects uncommitted loop work (L-29b)", () => {
  it("leaves a dirty worktree in place with a warning instead of force-removing it", async () => {
    execFileSync("git", ["init", "-q", "-b", "main", dir]);
    execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
    fs.writeFileSync(path.join(dir, "README.md"), "x");
    execFileSync("git", ["-C", dir, "add", "."]);
    execFileSync("git", ["-C", dir, "commit", "-qm", "init"]);
    await generate({ projectDir: dir, config: await merged({ isolate: true }) });
    const wt = (await ensureWorktree(dir)).path;
    fs.writeFileSync(path.join(wt, "uncommitted-loop-work.ts"), "precious");
    await generate({ projectDir: dir, config: await merged({ enabled: false }) });
    expect(fs.existsSync(path.join(wt, "uncommitted-loop-work.ts")), "uncommitted work was destroyed").toBe(true);
  }, 20_000);
});
