import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wrapWithLogger } from "../../src/generators/hooks.js";

// Exercises the shell-token helpers every Bash guard shares (#109):
//   _omh_simple_commands "<cmd>"        -> one simple command per line, TAB-separated tokens, quotes resolved
//   _omh_cmd_matches "<cmd>" argv0 [sub] -> 0 if some simple command is argv0 [sub]
//   _omh_cmd_has_pattern "<cmd>" "<pat>" -> 0 if pat's tokens appear contiguously in some simple command

let tmpDir: string;
let probe: string;

function run(fn: string, ...args: string[]): { code: number; out: string } {
  const quoted = args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(" ");
  try {
    const out = execSync(`/bin/bash "${probe}" ${fn} ${quoted}`, {
      cwd: tmpDir,
      encoding: "utf-8",
      timeout: 5000,
      input: "{}",
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string };
    return { code: err.status, out: err.stdout ?? "" };
  }
}

const matches = (cmd: string, argv0: string, sub = "") =>
  run("_omh_cmd_matches", cmd, argv0, sub).code === 0;
const hasPattern = (cmd: string, pat: string) => run("_omh_cmd_has_pattern", cmd, pat).code === 0;
const simple = (cmd: string) =>
  run("_omh_simple_commands", cmd).out.trimEnd().split("\n").map((l) => l.split("\t"));

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "omh-cmd-parser-"));
  // A hook whose body just dispatches to the helper named in $1.
  const script = wrapWithLogger(
    `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
FN="$1"; shift
_OMH_LOGGED=1
"$FN" "$@"`,
    "PreToolUse",
    tmpDir,
  );
  probe = join(tmpDir, "probe.sh");
  await writeFile(probe, script, { mode: 0o755 });
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("_omh_simple_commands", () => {
  it("splits on ; && || | and newlines", () => {
    expect(simple("cd foo && git commit -m x; ls | wc -l\necho done")).toEqual([
      ["cd", "foo"],
      ["git", "commit", "-m", "x"],
      ["ls"],
      ["wc", "-l"],
      ["echo", "done"],
    ]);
  });

  it("keeps quoted arguments as single tokens and resolves the quotes", () => {
    expect(simple(`git commit -m "add discount; fix && stuff"`)).toEqual([
      ["git", "commit", "-m", "add discount; fix && stuff"],
    ]);
    expect(simple(`echo 'a | b' "c'd"`)).toEqual([["echo", "a | b", "c'd"]]);
  });

  it("skips heredoc bodies", () => {
    const cmd = `gh pr create --body "$(cat <<'EOF'
run git commit and rm -rf / please
EOF
)" && echo ok`;
    const lines = simple(cmd);
    expect(lines.some((l) => l.join(" ").includes("rm -rf /"))).toBe(false);
    expect(lines).toContainEqual(["echo", "ok"]);
  });

  it("drops comments", () => {
    expect(simple("ls # git commit here")).toEqual([["ls"]]);
  });
});

describe("_omh_cmd_matches", () => {
  it("matches argv0 + subcommand at the head of a simple command", () => {
    expect(matches("git commit -m wip", "git", "commit")).toBe(true);
    expect(matches("git push origin main", "git", "push")).toBe(true);
    expect(matches("git status", "git", "commit")).toBe(false);
  });

  it("sees through leading git options like -c and -C", () => {
    expect(matches("git -c user.name=x -c user.email=y commit -qm init", "git", "commit")).toBe(true);
    expect(matches("git -C sub commit -m x", "git", "commit")).toBe(true);
  });

  it("finds the command anywhere in a pipeline or list", () => {
    expect(matches("cd app && git commit -m x", "git", "commit")).toBe(true);
    expect(matches("make || git commit -m fallback", "git", "commit")).toBe(true);
  });

  it("does not fire on the words inside a quoted string or heredoc", () => {
    expect(matches(`gh pr create --body "please run git commit"`, "git", "commit")).toBe(false);
    expect(matches(`echo 'git push'`, "git", "push")).toBe(false);
    expect(
      matches(`cat > note.md <<'EOF'\nthen git commit -m x\nEOF`, "git", "commit"),
    ).toBe(false);
  });

  it("matches argv0 alone when no subcommand is given", () => {
    expect(matches("rm -rf build", "rm")).toBe(true);
    expect(matches("echo rm", "rm")).toBe(false);
  });
});

describe("_omh_cmd_has_pattern", () => {
  it("matches when the pattern tokens appear contiguously in a simple command", () => {
    expect(hasPattern("rm -rf /", "rm -rf /")).toBe(true);
    expect(hasPattern('rm -rf "/"', "rm -rf /")).toBe(true);
    expect(hasPattern("sudo rm -rf /var/x", "sudo rm")).toBe(true);
    expect(hasPattern("chmod -R 777 .", "chmod -R 777")).toBe(true);
    expect(hasPattern("ls && rm -rf /", "rm -rf /")).toBe(true);
    expect(hasPattern("sudo rm -rf /", "rm -rf /")).toBe(true);
    expect(hasPattern("git push --force origin main", "--force")).toBe(true);
  });

  it("is token-exact, not substring", () => {
    expect(hasPattern("rm -rf /tmp/build", "rm -rf /")).toBe(false);
    expect(hasPattern("rm -rf ./", "rm -rf /")).toBe(false);
  });

  it("ignores the pattern inside quoted text", () => {
    expect(hasPattern(`echo "rm -rf /"`, "rm -rf /")).toBe(false);
    expect(hasPattern(`echo "git push --force"`, "--force")).toBe(false);
    expect(hasPattern(`gh issue create --body 'never run rm -rf /'`, "rm -rf /")).toBe(false);
  });
});
