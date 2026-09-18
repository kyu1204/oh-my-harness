import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm, writeFile, appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderTemplate } from "../../src/catalog/template-engine.js";
import { wrapWithLogger } from "../../src/generators/hooks.js";
import { commitTestGate } from "../../src/catalog/blocks/commit-test-gate.js";
import { commitTypecheckGate } from "../../src/catalog/blocks/commit-typecheck-gate.js";

// #112: commit gates skip the run when the working tree is unchanged since
// the last pass. Fingerprint = HEAD + tree hash of everything (tracked and
// untracked) so any content change invalidates it.

let dir: string;
let markerDir: string;

function sh(cmd: string, cwd = dir): string {
  return execSync(cmd, { cwd, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] });
}

function hasJq(): boolean {
  try { sh("jq --version"); return true; } catch { return false; }
}

async function gate(block: typeof commitTestGate, params: Record<string, unknown>, name: string): Promise<string> {
  const wrapped = wrapWithLogger(renderTemplate(block.template, params), "PreToolUse", dir);
  const p = join(dir, name);
  await writeFile(p, wrapped, { mode: 0o755 });
  return p;
}

function commitAttempt(script: string, cwd = dir): string {
  try {
    return execSync(`/bin/bash "${script}"`, {
      cwd, encoding: "utf-8", timeout: 10_000,
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git commit -m x" } }),
    });
  } catch (e) {
    return (e as { stdout?: string }).stdout ?? "";
  }
}

async function runs(): Promise<number> {
  const f = join(markerDir, "runs.log");
  return existsSync(f) ? (await readFile(f, "utf-8")).split("\n").filter(Boolean).length : 0;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omh-gate-cache-"));
  markerDir = await mkdtemp(join(tmpdir(), "omh-gate-marker-"));
  sh("git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init");
  await writeFile(join(dir, "src.txt"), "v1\n");
  sh("git add -A && git -c user.name=t -c user.email=t@t commit -q -m one");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(markerDir, { recursive: true, force: true });
});

describe.skipIf(!hasJq())("commit gate cache (#112)", () => {
  // The gate wraps the command with ">&2 2>&1", so the marker is written by a
  // subshell whose redirection the wrapper cannot override, and it lives
  // outside the repo so recording it never changes the fingerprint.
  const record = () => `bash -c 'echo run >> "${markerDir}/runs.log"'`;

  it("runs once, then skips while the tree is unchanged", async () => {
    const s = await gate(commitTestGate, { testCommand: record(), cacheTtlSeconds: 600 }, "gate.sh");
    expect(commitAttempt(s).trim()).toBe("");
    expect(commitAttempt(s).trim()).toBe("");
    expect(await runs()).toBe(1);
  });

  it("re-runs after a tracked file changes", async () => {
    const s = await gate(commitTestGate, { testCommand: record(), cacheTtlSeconds: 600 }, "gate.sh");
    commitAttempt(s);
    await writeFile(join(dir, "src.txt"), "v2\n");
    commitAttempt(s);
    expect(await runs()).toBe(2);
  });

  it("re-runs after a same-size rewrite in the same second (git stat cache must not be trusted)", async () => {
    const s = await gate(commitTestGate, { testCommand: record(), cacheTtlSeconds: 600 }, "gate.sh");
    for (let i = 0; i < 3; i++) {
      await writeFile(join(dir, "src.txt"), `v${i}\n`);   // same byte length every time
      commitAttempt(s);
    }
    expect(await runs()).toBe(3);
  });

  it("re-runs after an untracked file appears or changes", async () => {
    const s = await gate(commitTestGate, { testCommand: record(), cacheTtlSeconds: 600 }, "gate.sh");
    commitAttempt(s);
    await writeFile(join(dir, "new.txt"), "a\n");
    commitAttempt(s);
    await appendFile(join(dir, "new.txt"), "b\n");
    commitAttempt(s);
    expect(await runs()).toBe(3);
  });

  it("re-runs after HEAD moves even if the tree content is identical", async () => {
    const s = await gate(commitTestGate, { testCommand: record(), cacheTtlSeconds: 600 }, "gate.sh");
    commitAttempt(s);
    sh("git -c user.name=t -c user.email=t@t commit -q --allow-empty -m bump");
    commitAttempt(s);
    expect(await runs()).toBe(2);
  });

  it("cacheTtlSeconds: 0 disables caching", async () => {
    const s = await gate(commitTestGate, { testCommand: record(), cacheTtlSeconds: 0 }, "gate.sh");
    commitAttempt(s);
    commitAttempt(s);
    expect(await runs()).toBe(2);
  });

  it("does not record a failed run", async () => {
    const s = await gate(commitTestGate, { testCommand: `bash -c 'echo run >> "${markerDir}/runs.log"; exit 1'`, cacheTtlSeconds: 600 }, "gate.sh");
    expect(JSON.parse(commitAttempt(s).trim()).decision).toBe("block");
    expect(JSON.parse(commitAttempt(s).trim()).decision).toBe("block");
    expect(await runs()).toBe(2);
  });

  it("does not cache outside a git repository", async () => {
    await rm(join(dir, ".git"), { recursive: true, force: true });
    const s = await gate(commitTestGate, { testCommand: record(), cacheTtlSeconds: 600 }, "gate.sh");
    commitAttempt(s);
    commitAttempt(s);
    expect(await runs()).toBe(2);
  });

  it("still caches when .omh/state is gitignored, as omh's own .gitignore does (QA)", async () => {
    await writeFile(join(dir, ".gitignore"), ".omh/state/\nnode_modules/\n");
    sh("git add -A && git -c user.name=t -c user.email=t@t commit -q -m ignore");
    const s = await gate(commitTestGate, { testCommand: record(), cacheTtlSeconds: 600 }, "gate.sh");
    commitAttempt(s);
    commitAttempt(s);
    expect(await runs()).toBe(1);
  });

  it("re-runs when the test command changes on the same tree (review of #139)", async () => {
    const a = await gate(commitTestGate, { testCommand: record(), cacheTtlSeconds: 600 }, "gate-a.sh");
    const b = await gate(commitTestGate, { testCommand: `${record()} && true`, cacheTtlSeconds: 600 }, "gate-b.sh");
    commitAttempt(a);
    commitAttempt(b);   // different command, same tree: must not be served from a's cache
    expect(await runs()).toBe(2);
  });

  it("the two gates keep separate caches", async () => {
    const t = await gate(commitTestGate, { testCommand: record(), cacheTtlSeconds: 600 }, "test-gate.sh");
    const y = await gate(commitTypecheckGate, { typecheckCommand: record(), cacheTtlSeconds: 600 }, "type-gate.sh");
    commitAttempt(t);
    commitAttempt(y);
    commitAttempt(t);
    commitAttempt(y);
    expect(await runs()).toBe(2);
  });

  it("fingerprints the whole repository even when the hook runs in a subdirectory (review)", async () => {
    sh("mkdir -p packages/a packages/b && echo a > packages/a/x.txt && echo b > packages/b/y.txt && git add -A && git -c user.name=t -c user.email=t@t commit -q -m pkgs");
    const s = await gate(commitTestGate, { testCommand: record(), cacheTtlSeconds: 600 }, "gate.sh");
    commitAttempt(s, join(dir, "packages/a"));
    await writeFile(join(dir, "packages/b/y.txt"), "changed\n");
    commitAttempt(s, join(dir, "packages/a"));
    expect(await runs()).toBe(2);
  });

  it("records the tree the command checked, not the tree it left behind (review)", async () => {
    // A test command that mutates a tracked file (snapshots, formatters):
    // the next attempt sees a different tree from the one that passed.
    const mutating = `bash -c 'echo run >> "${markerDir}/runs.log"; echo touched >> src.txt'`;
    const s = await gate(commitTestGate, { testCommand: mutating, cacheTtlSeconds: 600 }, "gate.sh");
    commitAttempt(s);
    commitAttempt(s);
    expect(await runs()).toBe(2);
  });

  it("leaves the real index untouched (fingerprint uses a temporary index)", async () => {
    const s = await gate(commitTestGate, { testCommand: record(), cacheTtlSeconds: 600 }, "gate.sh");
    await writeFile(join(dir, "unstaged.txt"), "x\n");
    commitAttempt(s);
    expect(sh("git diff --cached --name-only").trim()).toBe("");
    expect(sh("git status --porcelain")).toContain("?? unstaged.txt");
  });
});
