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

  it("strips leading tabs from the terminator only for <<- heredocs", () => {
    // Plain <<EOF: a tab-indented EOF line is body, not the terminator, so
    // the real terminator comes later and nothing in between is a command.
    expect(simple("cat <<EOF\n\tEOF\ngit commit -m x\nEOF\necho after")).toEqual([
      ["cat"],
      ["echo", "after"],
    ]);
    // <<-EOF: the tab-indented EOF terminates.
    expect(simple("cat <<-EOF\n\tEOF\ngit commit -m x")).toEqual([
      ["cat"],
      ["git", "commit", "-m", "x"],
    ]);
  });

  it("drops redirections so they cannot split or disguise a command", () => {
    const R = "__omh_redirect__";
    expect(simple("git 2>/dev/null commit -m x")).toEqual([[R, "/dev/null"], ["git", "commit", "-m", "x"]]);
    expect(simple("rm 2> /dev/null -rf /")).toEqual([[R, "/dev/null"], ["rm", "-rf", "/"]]);
    expect(simple("make >build.log 2>&1 && echo ok")).toEqual([[R, "build.log"], ["make"], ["echo", "ok"]]);
    expect(simple("cat < in.txt >> out.txt")).toEqual([[R, "out.txt"], ["cat"]]);
    expect(simple(`cat <<< "not a heredoc"`)).toEqual([["cat"]]);
  });

  it("reports output-redirection targets as __omh_redirect__ lines", () => {
    expect(simple("echo x > .claude/settings.json")).toEqual([
      ["__omh_redirect__", ".claude/settings.json"],
      ["echo", "x"],
    ]);
    expect(simple("cat a >>out.log 2>&1")).toEqual([["__omh_redirect__", "out.log"], ["cat", "a"]]);
    expect(simple("make &> build.log")).toEqual([["__omh_redirect__", "build.log"], ["make"]]);
    // reads and fd dups are not writes
    expect(simple("wc -l < in.txt")).toEqual([["wc", "-l"]]);
    expect(simple("echo hi >&2")).toEqual([["echo", "hi"]]);
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

  it("skips leading environment assignments", () => {
    expect(matches("CI=1 GIT_AUTHOR_NAME=x git commit -m x", "git", "commit")).toBe(true);
    expect(matches("FOO=bar rm -rf build", "rm")).toBe(true);
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

describe("wrapper unwrapping (#110)", () => {
  it("strips leading privilege / environment / scheduling wrappers", () => {
    // sudo/doas stay visible so user patterns like "sudo rm" keep working;
    // _omh_cmd_matches skips them (see "guards see through wrappers").
    expect(simple("sudo rm -rf /")).toEqual([["sudo", "rm", "-rf", "/"]]);
    expect(simple("env FOO=1 git commit -m x")).toEqual([["git", "commit", "-m", "x"]]);
    expect(simple("env -i -u HOME git commit -m x")).toEqual([["git", "commit", "-m", "x"]]);
    expect(simple("timeout 30 git commit -m x")).toEqual([["git", "commit", "-m", "x"]]);
    expect(simple("timeout -s KILL 5s rm -rf /")).toEqual([["rm", "-rf", "/"]]);
    expect(simple("nohup nice -n 10 command exec git push origin main")).toEqual([
      ["git", "push", "origin", "main"],
    ]);
    expect(simple("xargs -0 -I{} rm -rf /")).toEqual([["rm", "-rf", "/"]]);
  });

  it("re-parses the string given to sh -c / bash -c / eval", () => {
    expect(simple(`sh -c "git commit -m wip"`)).toEqual([["git", "commit", "-m", "wip"]]);
    expect(simple(`bash -lc 'cd app && git commit -m x'`)).toEqual([
      ["cd", "app"],
      ["git", "commit", "-m", "x"],
    ]);
    expect(simple(`eval "rm -rf /"`)).toEqual([["rm", "-rf", "/"]]);
    expect(simple("eval git commit -m x")).toEqual([["git", "commit", "-m", "x"]]);
    // nested wrappers
    expect(simple(`sh -c 'timeout 5 rm -rf /'`)).toEqual([["rm", "-rf", "/"]]);
  });

  it("does not treat a shell running a script file as a wrapper", () => {
    expect(simple("bash ./deploy.sh")).toEqual([["bash", "./deploy.sh"]]);
    expect(simple("sh -x run.sh")).toEqual([["sh", "-x", "run.sh"]]);
  });

  it("stops unwrapping at a bounded depth instead of recursing forever", () => {
    let cmd = "rm -rf /";
    // 6 levels is past the depth cap; quote escaping grows ~3x per level so keep it small
    for (let i = 0; i < 6; i++) cmd = `sh -c '${cmd.replace(/'/g, `'\\''`)}'`;
    const lines = simple(cmd);
    // terminates quickly and leaves the innermost wrapper unparsed
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0][0]).toBe("sh");
  });

  it("guards see through wrappers", () => {
    expect(matches(`bash -c "git commit -m wip"`, "git", "commit")).toBe(true);
    expect(matches("sudo git push --force origin main", "git", "push")).toBe(true);
    expect(matches("sudo -u deploy -n git push origin main", "git", "push")).toBe(true);
    expect(hasPattern("sudo rm -rf /var/x", "sudo rm")).toBe(true);
    expect(hasPattern("env FOO=1 rm -rf /", "rm -rf /")).toBe(true);
    expect(hasPattern("timeout 5 rm -rf /", "rm -rf /")).toBe(true);
    expect(hasPattern(`sh -c 'rm -rf /'`, "rm -rf /")).toBe(true);
    // still not fooled by strings that are not executed
    expect(hasPattern(`echo 'sh -c "rm -rf /"'`, "rm -rf /")).toBe(false);
  });
});
