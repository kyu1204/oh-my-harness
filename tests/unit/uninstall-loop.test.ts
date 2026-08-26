import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { computeUninstall } from "../../src/core/uninstall.js";
import { execFileSync } from "node:child_process";
import { ensureWorktree } from "../../src/loop/worktree.js";

describe("uninstall removes loop assets", () => {
  it("deletes the omh-loop skill directory", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-unins-"));
    const skillDir = path.join(dir, ".claude", "skills", "omh-loop");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "x", "utf-8");
    const plan = await computeUninstall({ projectDir: dir });
    expect(plan.delete).toContain(skillDir);
  });
});

describe("uninstall tears the loop down", () => {
  it("removes the isolated worktree while planning", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-unins-wt-"));
    execFileSync("git", ["init", "-q", "-b", "main", dir]);
    execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
    await fs.writeFile(path.join(dir, "README.md"), "x");
    execFileSync("git", ["-C", dir, "add", "."]);
    execFileSync("git", ["-C", dir, "commit", "-qm", "init"]);
    const wt = (await ensureWorktree(dir)).path;
    await computeUninstall({ projectDir: dir });
    expect(await fs.access(wt).then(() => true, () => false)).toBe(false);
  }, 20_000);
});
