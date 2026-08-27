import { describe, it, expect, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  WorktreeError,
  removeWorktreeIfClean,
  git,
  headOf,
  currentBranch,
  ensureWorktree,
  syncAssets,
  seedLedger,
  removeWorktree,
} from "../../src/loop/worktree.js";
import { loopPaths } from "../../src/loop/state.js";

const SLOW = 20_000;
let dir: string;

function sh(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf-8" }).trim();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "omh-wt-"));
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  sh(dir, ["config", "user.email", "t@t"]);
  sh(dir, ["config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  fs.writeFileSync(path.join(dir, "WORKPLAN.md"), "- [ ] T-1\n");
  sh(dir, ["add", "."]);
  sh(dir, ["commit", "-qm", "init"]);
});

describe("git helpers", () => {
  it("git() returns trimmed stdout and wraps failures in WorktreeError", async () => {
    expect(await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
    await expect(git(dir, ["rev-parse", "--verify", "nope"])).rejects.toBeInstanceOf(WorktreeError);
    expect(await headOf(dir)).toMatch(/^[0-9a-f]{40}$/);
    expect(await currentBranch(dir)).toBe("main");
  });
});

describe("ensureWorktree", () => {
  it("creates the worktree on a fresh omh-loop branch", async () => {
    const r = await ensureWorktree(dir);
    expect(r.path).toBe(loopPaths(dir).worktree);
    expect(r.reusedBranch).toBe(false);
    expect(await currentBranch(r.path)).toBe("omh-loop");
    expect(sh(dir, ["worktree", "list", "--porcelain"])).toContain(r.path);
  }, SLOW);

  it("is idempotent when the worktree is already registered", async () => {
    const a = await ensureWorktree(dir);
    const b = await ensureWorktree(dir);
    expect(b.path).toBe(a.path);
  }, SLOW);

  it("reuses an existing omh-loop branch when only the worktree is gone", async () => {
    await ensureWorktree(dir);
    await removeWorktree(dir);
    expect(sh(dir, ["branch", "--list", "omh-loop"])).toContain("omh-loop");
    const r = await ensureWorktree(dir);
    expect(r.reusedBranch).toBe(true);
  }, SLOW);

  it("refuses an unregistered, non-empty worktree directory and points at omh loop clean", async () => {
    const wt = loopPaths(dir).worktree;
    fs.mkdirSync(wt, { recursive: true });
    fs.writeFileSync(path.join(wt, "leftover.txt"), "uncommitted loop work");
    await expect(ensureWorktree(dir)).rejects.toThrow(/omh loop clean/);
  }, SLOW);

  it("adopts an unregistered but empty directory", async () => {
    fs.mkdirSync(loopPaths(dir).worktree, { recursive: true });
    const r = await ensureWorktree(dir);
    expect(await currentBranch(r.path)).toBe("omh-loop");
  }, SLOW);

  it("refuses to run when the main tree itself is on omh-loop", async () => {
    sh(dir, ["checkout", "-qb", "omh-loop"]);
    await expect(ensureWorktree(dir)).rejects.toThrow(/omh-loop/);
  }, SLOW);
});

describe("syncAssets", () => {
  it("copies uncommitted architect assets into the worktree and skips missing ones", async () => {
    const { path: wt } = await ensureWorktree(dir);
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "settings.json"), "{}");
    fs.mkdirSync(path.join(dir, "docs", "work-orders"), { recursive: true });
    fs.writeFileSync(path.join(dir, "docs", "work-orders", "T-1.md"), "order");
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "rules");
    const copied = await syncAssets(dir, wt, "docs/work-orders");
    expect(copied).toEqual(expect.arrayContaining(["docs/work-orders", ".claude", "CLAUDE.md"]));
    expect(copied).not.toContain(".codex");
    expect(fs.readFileSync(path.join(wt, ".claude", "settings.json"), "utf-8")).toBe("{}");
    expect(fs.readFileSync(path.join(wt, "docs", "work-orders", "T-1.md"), "utf-8")).toBe("order");
    // a second sync overwrites with newer content
    fs.writeFileSync(path.join(dir, "docs", "work-orders", "T-1.md"), "order v2");
    await syncAssets(dir, wt, "docs/work-orders");
    expect(fs.readFileSync(path.join(wt, "docs", "work-orders", "T-1.md"), "utf-8")).toBe("order v2");
  }, SLOW);
});

describe("seedLedger", () => {
  it("seeds on first run, keeps the loop's ticks on a same-hash restart, reseeds on a new goal", async () => {
    const { path: wt } = await ensureWorktree(dir);
    // the worktree checkout has the committed ledger; treat it as absent to model a fresh goal
    fs.rmSync(path.join(wt, "WORKPLAN.md"));
    const first = await seedLedger(dir, wt, "WORKPLAN.md");
    expect(first.seeded).toBe(true);
    expect(fs.existsSync(loopPaths(dir).seedJson)).toBe(true);

    // the loop makes progress in the worktree copy
    fs.writeFileSync(path.join(wt, "WORKPLAN.md"), "- [x] T-1\n");
    const restart = await seedLedger(dir, wt, "WORKPLAN.md");
    expect(restart.seeded).toBe(false);
    expect(fs.readFileSync(path.join(wt, "WORKPLAN.md"), "utf-8")).toBe("- [x] T-1\n");

    // the architect writes a new goal
    fs.writeFileSync(path.join(dir, "WORKPLAN.md"), "- [ ] T-1\n- [ ] T-2\n");
    const newGoal = await seedLedger(dir, wt, "WORKPLAN.md");
    expect(newGoal.seeded).toBe(true);
    expect(fs.readFileSync(path.join(wt, "WORKPLAN.md"), "utf-8")).toBe("- [ ] T-1\n- [ ] T-2\n");
  }, SLOW);

  it("creates the parent directory for a nested ledger and fails loud when the ledger is missing", async () => {
    const { path: wt } = await ensureWorktree(dir);
    fs.mkdirSync(path.join(dir, "planning"));
    fs.writeFileSync(path.join(dir, "planning", "WORKPLAN.md"), "- [ ] N-1\n");
    const r = await seedLedger(dir, wt, "planning/WORKPLAN.md");
    expect(r.seeded).toBe(true);
    expect(fs.existsSync(path.join(wt, "planning", "WORKPLAN.md"))).toBe(true);
    await expect(seedLedger(dir, wt, "missing/LEDGER.md")).rejects.toBeInstanceOf(WorktreeError);
  }, SLOW);
});

describe("removeWorktree", () => {
  it("removes even a dirty worktree, keeps the branch, and can delete the branch on request", async () => {
    const { path: wt } = await ensureWorktree(dir);
    fs.writeFileSync(path.join(wt, "dirty.txt"), "uncommitted");
    await removeWorktree(dir);
    expect(fs.existsSync(wt)).toBe(false);
    expect(sh(dir, ["branch", "--list", "omh-loop"])).toContain("omh-loop");
    await removeWorktree(dir, { branch: true });
    expect(sh(dir, ["branch", "--list", "omh-loop"])).toBe("");
    // idempotent when nothing is there
    await removeWorktree(dir, { branch: true });
  }, SLOW);
});

describe("seedLedger — reseed backup (L-29a)", () => {
  it("saves the worktree ledger aside before a new goal overwrites it", async () => {
    const { path: wt } = await ensureWorktree(dir);
    fs.rmSync(path.join(wt, "WORKPLAN.md"));
    await seedLedger(dir, wt, "WORKPLAN.md");
    // the loop makes uncommitted progress
    fs.writeFileSync(path.join(wt, "WORKPLAN.md"), "- [x] T-1\n");
    // architect writes a new goal → reseed must not silently destroy the ticks
    fs.writeFileSync(path.join(dir, "WORKPLAN.md"), "- [ ] N-1\n");
    const r = await seedLedger(dir, wt, "WORKPLAN.md");
    expect(r.seeded).toBe(true);
    const backups = fs.readdirSync(wt).filter((n) => n.startsWith("WORKPLAN.md.pre-seed-"));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(wt, backups[0]), "utf-8")).toBe("- [x] T-1\n");
  }, SLOW);
});

describe("removeWorktreeIfClean uses non-force removal (round 10)", () => {
  it("a clean worktree is removed; a dirty one is left with no force applied", async () => {
    const { path: wt } = await ensureWorktree(dir);
    await removeWorktreeIfClean(dir);
    expect(fs.existsSync(wt)).toBe(false);

    const { path: wt2 } = await ensureWorktree(dir);
    fs.writeFileSync(path.join(wt2, "precious.ts"), "uncommitted");
    await removeWorktreeIfClean(dir);
    expect(fs.existsSync(path.join(wt2, "precious.ts"))).toBe(true);
  }, SLOW);
});
