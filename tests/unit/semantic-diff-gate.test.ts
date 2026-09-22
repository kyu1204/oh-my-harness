import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { semanticDiffGate } from "../../src/catalog/blocks/semantic-diff-gate.js";
import { builtinBlocks } from "../../src/catalog/blocks/index.js";
import { renderTemplate } from "../../src/catalog/template-engine.js";
import { wrapWithLogger } from "../../src/generators/hooks.js";

// #145: before `git commit`, run jgrep on the staged diff for each rule
// description; any hit blocks. jgrep is optional: absent → allow + skipped.
// A fake `jgrep` on PATH stands in for the real one.

let dir: string;
let bin: string;

function sh(cmd: string) {
  return execSync(cmd, { cwd: dir, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] });
}
function hasJq(): boolean {
  try { sh("jq --version"); return true; } catch { return false; }
}
async function fakeJgrep(script: string) {
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "jgrep"), `#!/bin/bash\n${script}\n`, { mode: 0o755 });
}
async function gate(params: Record<string, unknown>) {
  const p = join(dir, "sdg.sh");
  await writeFile(p, wrapWithLogger(renderTemplate(semanticDiffGate.template, params), "PreToolUse", dir), { mode: 0o755 });
  return p;
}
function commit(script: string, withJgrep = true): string {
  try {
    return execSync(`/bin/bash "${script}"`, {
      cwd: dir, encoding: "utf-8", timeout: 15_000,
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git commit -m x" } }),
      env: { ...process.env, PATH: withJgrep ? `${bin}:${process.env.PATH}` : "/usr/bin:/bin", TYPESAFE_API_KEY: "k" },
    });
  } catch (e) {
    return (e as { stdout?: string }).stdout ?? "";
  }
}
async function events() {
  return (await readFile(join(dir, ".omh", "state", "events.jsonl"), "utf-8")).trim().split("\n").map((l) => JSON.parse(l));
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omh-sdg-"));
  bin = join(dir, "fakebin");
  sh("git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init");
  await writeFile(join(dir, "app.ts"), "const token = 'sk-live-123';\n");
  sh("git add app.ts");
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("semanticDiffGate block", () => {
  it("has correct metadata and is registered", () => {
    expect(semanticDiffGate.id).toBe("semantic-diff-gate");
    expect(semanticDiffGate.event).toBe("PreToolUse");
    expect(semanticDiffGate.matcher).toBe("Bash");
    expect(semanticDiffGate.canBlock).toBe(true);
    expect(semanticDiffGate.params.map((p) => p.name)).toEqual(["rules", "threshold", "jgrep"]);
    expect(semanticDiffGate.params.find((p) => p.name === "threshold")!.default).toBe(0.85);
    expect(builtinBlocks.map((b) => b.id)).toContain("semantic-diff-gate");
    expect(semanticDiffGate.explain?.change).toBeTruthy();
  });
});

describe.skipIf(!hasJq())("semantic-diff-gate execution", () => {
  const RULES = ["hardcodes a secret, token or password", "catches an error and silently ignores it"];

  it("runs jgrep once per rule on the staged diff and blocks on a hit with file:line and p", async () => {
    await fakeJgrep(`echo "$@" >> "${dir}/jgrep.calls"
case "$*" in *secret*) echo '[{"file":"app.ts","start":1,"end":1,"p":0.97,"text":"const token = ..."}]'; exit 0 ;; *) echo '[]'; exit 1 ;; esac`);
    const s = await gate({ rules: RULES, threshold: 0.85, jgrep: "jgrep" });
    const out = JSON.parse(commit(s).trim());
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/hardcodes a secret/);
    expect(out.reason).toMatch(/app\.ts:1/);
    expect(out.reason).toMatch(/0\.97/);
    const calls = (await readFile(join(dir, "jgrep.calls"), "utf-8")).trim().split("\n");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/--json/);
    expect(calls[0]).toMatch(/-t 0\.85/);
    expect(calls[0]).toMatch(/--diff --staged/);
  });

  it("allows when no rule hits", async () => {
    await fakeJgrep(`echo '[]'; exit 1`);
    const s = await gate({ rules: RULES, threshold: 0.85, jgrep: "jgrep" });
    expect(commit(s).trim()).toBe("");
  });

  it("allows and logs skipped when jgrep is not installed or the key is missing", async () => {
    const s = await gate({ rules: RULES, threshold: 0.85, jgrep: "jgrep" });
    expect(commit(s, false).trim()).toBe("");
    const ev = await events();
    expect(ev.at(-1)).toMatchObject({ decision: "allow", reason: expect.stringMatching(/skipped: jgrep not found/) });
  });

  it("allows and logs an error when jgrep itself fails (exit 2)", async () => {
    await fakeJgrep(`echo "boom" >&2; exit 2`);
    const s = await gate({ rules: RULES, threshold: 0.85, jgrep: "jgrep" });
    expect(commit(s).trim()).toBe("");
    const ev = await events();
    expect(ev.at(-1)).toMatchObject({ decision: "allow", reason: expect.stringMatching(/jgrep failed/) });
  });

  // Claude usually stages and commits in one call. At PreToolUse time nothing is
  // staged yet, so the gate previews the index the command would build.
  const INDEX_AWARE = `if git diff --staged | grep -q sk-live; then echo '[{"file":"x","start":1,"end":1,"p":0.97,"text":"t"}]'; exit 0; fi; echo '[]'; exit 1`;
  function commitCmd(script: string, command: string): string {
    try {
      return execSync(`/bin/bash "${script}"`, { cwd: dir, encoding: "utf-8", timeout: 15_000, input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }), env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    } catch (e) { return (e as { stdout?: string }).stdout ?? ""; }
  }

  it("lints what `git add <paths> && git commit` would stage, and only that", async () => {
    sh("git reset -q");
    await writeFile(join(dir, "secret.ts"), "const k = 'sk-live-999';\n");
    await writeFile(join(dir, "clean.ts"), "export const ok = 1;\n");
    await fakeJgrep(INDEX_AWARE);
    const s = await gate({ rules: ["hardcodes a secret"], threshold: 0.85, jgrep: "jgrep" });
    expect(JSON.parse(commitCmd(s, "git add secret.ts && git commit -m x").trim()).decision).toBe("block");
    expect(commitCmd(s, "git add clean.ts && git commit -m x").trim()).toBe("");
    expect(JSON.parse(commitCmd(s, "git add -A && git commit -m x").trim()).decision).toBe("block");
    // the real index is untouched by the preview
    expect(sh("git diff --staged --name-only").trim()).toBe("");
  });

  it("keeps the command's directory context, and falls back to the whole working tree when it cannot replay faithfully (review of #151)", async () => {
    sh("git reset -q");
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(join(dir, "sub", "token.ts"), "const k = 'sk-live-777';\n");
    await writeFile(join(dir, "clean.ts"), "export const ok = 1;\n");
    await fakeJgrep(INDEX_AWARE);
    const s = await gate({ rules: ["hardcodes a secret"], threshold: 0.85, jgrep: "jgrep" });
    // git -C carries the directory
    expect(JSON.parse(commitCmd(s, "git -C sub add token.ts && git -C sub commit -m x").trim()).decision).toBe("block");
    // cd changes what a relative path means: replay everything dirty rather than guess
    expect(JSON.parse(commitCmd(s, "cd sub && git add token.ts && git commit -m x").trim()).decision).toBe("block");
    // a git add that cannot be replayed (unknown path) also widens to the whole tree
    expect(JSON.parse(commitCmd(s, "git add nope.ts && git commit -m x").trim()).decision).toBe("block");
    // a faithful replay stays precise
    expect(commitCmd(s, "git add clean.ts && git commit -m x").trim()).toBe("");
    expect(sh("git diff --staged --name-only").trim()).toBe("");
  });

  it("lints tracked modifications for `git commit -a`", async () => {
    sh("git add app.ts && git -c user.name=t -c user.email=t@t commit -qm base");
    await writeFile(join(dir, "app.ts"), "const token = 'sk-live-456';\n");
    await fakeJgrep(INDEX_AWARE);
    const s = await gate({ rules: ["hardcodes a secret"], threshold: 0.85, jgrep: "jgrep" });
    expect(JSON.parse(commitCmd(s, "git commit -am x").trim()).decision).toBe("block");
    expect(commitCmd(s, "git commit -m x").trim()).toBe("");
  });

  it("ignores commands that are not git commit", async () => {
    await fakeJgrep(`echo "should not run" >> "${dir}/jgrep.calls"; exit 0`);
    const s = await gate({ rules: RULES, threshold: 0.85, jgrep: "jgrep" });
    execSync(`/bin/bash "${s}"`, { cwd: dir, input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" } }), env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TYPESAFE_API_KEY: "k" } });
    await expect(readFile(join(dir, "jgrep.calls"), "utf-8")).rejects.toThrow();
  });
});
