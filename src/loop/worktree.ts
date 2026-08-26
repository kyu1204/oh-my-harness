import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hashLedger } from "./ledger.js";
import { loopPaths, atomicWrite } from "./state.js";

const execFileAsync = promisify(execFile);

/**
 * The loop's isolated git worktree and everything that has to flow into it.
 *
 * `git worktree add` checks out HEAD, so anything the architect wrote but has
 * not committed — the ledger, the work orders, the generated harness config —
 * would be missing. Architect-owned assets are copied in on every iteration;
 * the ledger is seeded once per goal (by content hash) and then belongs to
 * the loop, so its checkbox progress is never rolled back mid-run.
 */
export class WorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeError";
  }
}

export async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf-8" });
    return stdout.trim();
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new WorktreeError(`git ${args.join(" ")} failed: ${(e.stderr ?? e.message).trim()}`);
  }
}

export async function headOf(cwd: string): Promise<string> {
  return git(cwd, ["rev-parse", "HEAD"]);
}

export async function currentBranch(cwd: string): Promise<string> {
  return git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

async function branchExists(cwd: string, branch: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

async function isRegisteredWorktree(projectDir: string, wt: string): Promise<boolean> {
  const list = await git(projectDir, ["worktree", "list", "--porcelain"]);
  const real = (p: string) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return p;
    }
  };
  return list.split("\n").some((l) => l.startsWith("worktree ") && real(l.slice("worktree ".length)) === real(wt));
}

export interface EnsureResult {
  path: string;
  /** The omh-loop branch already existed (from an earlier run) and was checked out as-is. */
  reusedBranch: boolean;
}

export async function ensureWorktree(projectDir: string): Promise<EnsureResult> {
  const p = loopPaths(projectDir);
  if ((await currentBranch(projectDir)) === p.branch) {
    throw new WorktreeError(`the main tree is checked out on ${p.branch}; switch branches before starting the loop`);
  }
  await git(projectDir, ["worktree", "prune"]);
  if (await isRegisteredWorktree(projectDir, p.worktree)) {
    return { path: p.worktree, reusedBranch: false };
  }
  if (fs.existsSync(p.worktree)) {
    if (fs.readdirSync(p.worktree).length > 0) {
      // Never delete: it may hold uncommitted loop work from a crashed run.
      throw new WorktreeError(`${p.worktree} exists but is not a registered worktree; run 'omh loop clean' to remove it`);
    }
    fs.rmdirSync(p.worktree);
  }
  fs.mkdirSync(path.dirname(p.worktree), { recursive: true });
  const reusedBranch = await branchExists(projectDir, p.branch);
  await git(
    projectDir,
    reusedBranch ? ["worktree", "add", p.worktree, p.branch] : ["worktree", "add", "-b", p.branch, p.worktree],
  );
  return { path: p.worktree, reusedBranch };
}

/** Architect-owned paths that must reach the worktree even when uncommitted. */
export function architectAssets(workOrders: string): string[] {
  return [workOrders, ".claude", ".codex", ".pi", ".omh/hooks", "CLAUDE.md", "AGENTS.md", "harness.yaml"];
}

export async function syncAssets(projectDir: string, worktree: string, workOrders: string): Promise<string[]> {
  const copied: string[] = [];
  for (const rel of architectAssets(workOrders)) {
    const src = path.join(projectDir, rel);
    if (!fs.existsSync(src)) continue;
    try {
      fs.cpSync(src, path.join(worktree, rel), { recursive: true, force: true });
    } catch (err) {
      throw new WorktreeError(`failed to copy ${rel} into the worktree: ${(err as Error).message}`);
    }
    copied.push(rel);
  }
  return copied;
}

export interface SeedResult {
  seeded: boolean;
  hash: string;
}

export async function seedLedger(projectDir: string, worktree: string, ledger: string): Promise<SeedResult> {
  const p = loopPaths(projectDir);
  const mainPath = path.join(projectDir, ledger);
  if (!fs.existsSync(mainPath)) throw new WorktreeError(`ledger ${ledger} is missing in the project`);
  const content = fs.readFileSync(mainPath, "utf-8");
  const hash = hashLedger(content);

  let previous: string | null = null;
  try {
    previous = (JSON.parse(fs.readFileSync(p.seedJson, "utf-8")) as { ledgerHash?: string }).ledgerHash ?? null;
  } catch {
    // first run
  }

  const target = path.join(worktree, ledger);
  if (fs.existsSync(target) && previous === hash) return { seeded: false, hash };

  // A reseed replaces the loop's own copy (new goal); any un-pushed ticks in
  // it are saved aside rather than silently destroyed.
  if (fs.existsSync(target)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(target, `${target}.pre-seed-${stamp}`);
  }
  atomicWrite(target, content);
  atomicWrite(p.seedJson, JSON.stringify({ ledgerHash: hash }, null, 2));
  return { seeded: true, hash };
}

export async function removeWorktree(projectDir: string, opts: { branch?: boolean } = {}): Promise<void> {
  const p = loopPaths(projectDir);
  if (await isRegisteredWorktree(projectDir, p.worktree)) {
    // Two --force: the second overrides a worktree lock as well as dirt.
    await git(projectDir, ["worktree", "remove", "--force", "--force", p.worktree]);
  }
  fs.rmSync(p.worktree, { recursive: true, force: true });
  await git(projectDir, ["worktree", "prune"]);
  if (opts.branch && (await branchExists(projectDir, p.branch))) {
    await git(projectDir, ["branch", "-D", p.branch]);
  }
}

/**
 * Remove the worktree only when it holds no uncommitted work; otherwise warn
 * and leave it. Routine paths (sync with the loop disabled) use this;
 * explicit destruction stays with `omh loop clean` and uninstall.
 */
export async function removeWorktreeIfClean(projectDir: string): Promise<void> {
  const p = loopPaths(projectDir);
  if (!fs.existsSync(p.worktree)) return;
  try {
    const status = await git(p.worktree, ["status", "--porcelain"]);
    if (status !== "") {
      console.warn(
        `oh-my-harness: loop worktree at ${p.worktree} has uncommitted work — left in place; ` +
          `commit or discard it, then run \`omh loop clean\``,
      );
      return;
    }
    await removeWorktree(projectDir);
  } catch {
    // an unreadable worktree is not something a routine sync should force away
  }
}
