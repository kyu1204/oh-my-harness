import type { BuildingBlock } from "../types.js";

// Closes the Bash side of harness self-protection (#113). path-guard's
// protectHarness stops Edit/Write on the hook files; this block stops shell
// commands that would rewrite, delete or neuter them: file tools with a
// protected path as an argument, output redirections into a protected path,
// and git checkout/restore/clean/rm/mv on one. Read-only commands (cat, grep,
// ls, diff, sed without -i) stay allowed so the agent can inspect its own rules, and `omh` is
// never a writer here, so `omh sync` / `omh hook add` remain the sanctioned
// way to change the harness.
// Scope (#133): by default only paths that resolve inside this project root
// count, following cd / pushd, ~, .. and absolute paths, so another checkout's
// .omh is not this harness's business. Tokens that cannot be resolved ($VAR,
// backticks, unknown cwd) fall back to name matching and stay fail-closed.
// ponytail: harness.yaml itself is deliberately not protected (it is the
// user's knob); per-hook `locked: true` is tracked in #118. `rm -rf .` / `*`
// from the project root are left to command-guard patterns.
export const harnessGuard: BuildingBlock = {
  id: "harness-guard",
  name: "Harness Guard",
  description:
    "Blocks shell commands that would modify or delete the harness's own hooks and runtime config (.omh/, .claude/settings.json, .codex/, .pi/)",
  category: "security",
  event: "PreToolUse",
  matcher: "Bash",
  canBlock: true,
  params: [
    {
      name: "extraPaths",
      type: "string[]",
      description: "Additional paths (relative to the project root) to protect from shell writes",
      default: [],
      required: false,
    },
    {
      name: "scope",
      type: "string",
      description: "project: only paths that resolve inside this project root are protected (cd and absolute paths are followed); any: match the protected names anywhere in the command",
      default: "project",
      required: false,
    },
  ],
  tags: ["security", "bash", "guard", "harness", "self-protection"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
# Codex apply_patch carries a diff, not a shell command; path-guard covers it.
[[ "$TOOL_NAME" == "apply_patch" ]] && exit 0
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -z "$COMMAND" ]] && exit 0

PROTECTED=(".omh" ".claude/settings.json" ".codex/hooks.json" ".codex/config.toml" ".pi/extensions/omh-harness.ts" {{#each extraPaths}}"{{{this}}}" {{/each}})
WRITERS="rm mv cp tee chmod chown chgrp truncate dd ln touch install rsync shred unlink perl"
GIT_WRITERS="checkout restore clean rm mv"

HIT=$(_omh_simple_commands "$COMMAND" | awk -F '\\t' \\
  -v protected="$(IFS='|'; printf '%s' "\${PROTECTED[*]}")" -v writers="$WRITERS" -v gitw="$GIT_WRITERS" \\
  -v root="$_OMH_PROJECT_ROOT" -v home="\${HOME:-}" -v scope='{{scope}}' "\${_OMH_AWK_PATHLIB}"'
  BEGIN {
    cwd = root
    np = split(protected, P, "|")
    nw = split(writers, W, " "); for (k = 1; k <= nw; k++) isw[W[k]] = 1
    ng = split(gitw, G, " ");    for (k = 1; k <= ng; k++) isg[G[k]] = 1
  }
  # name-based matching: scope=any, and the fallback for tokens that cannot be resolved
  function hits(t,   k, p, L) {
    sub(/^\\.\\//, "", t)
    for (k = 1; k <= np; k++) {
      p = P[k]; if (p == "") continue
      L = length(p)
      if (t == p) return p
      if (substr(t, 1, L + 1) == p "/") return p
      if (length(t) > L && substr(t, length(t) - L, L + 1) == "/" p) return p
      if (index(t, "/" p "/") > 0) return p
    }
    return ""
  }
  # project scope: the token must resolve (through cd, ~, .., absolute paths) to a protected path under root
  function check(t,   a, rel, k, p, L) {
    if (scope == "any") return hits(t)
    a = omh_abs(cwd, t, home)
    if (a == "") return hits(t)
    if (!omh_under(a, root)) return ""
    rel = (a == root) ? "" : substr(a, length(root) + 2)
    for (k = 1; k <= np; k++) {
      p = P[k]; if (p == "") continue
      sub(/^\\.\\//, "", p); L = length(p)
      if (rel == p || substr(rel, 1, L + 1) == p "/") return p
    }
    return ""
  }
  found != "" { next }
  {
    if ($1 == "__omh_redirect__") { p = check($2); if (p != "") found = "redirect into " p; next }
    i = 1
    while (i <= NF && $i ~ /^[A-Za-z_][A-Za-z0-9_]*=/) i++
    if (i <= NF && ($i == "sudo" || $i == "doas")) { i++; while (i <= NF && $i ~ /^-/) i++ }
    if (i > NF) next
    if ($i == "cd" || $i == "pushd") { cwd = omh_cd(cwd, (i + 1 <= NF ? $(i + 1) : ""), home); next }
    a0 = $i
    write = 0
    if (isw[a0]) write = 1
    else if (a0 == "sed") {   # sed only writes in place: -i, any -i cluster, --in-place or a GNU abbreviation of it (--i, --in-p ...)
      for (k = i + 1; k <= NF; k++) {
        if ($k == "--") break
        if ($k ~ /^-[A-Za-z]*i/) { write = 1; break }
        if ($k ~ /^--i/) { o = $k; sub(/=.*/, "", o); if (index("--in-place", o) == 1) { write = 1; break } }
      }
    }
    else if (a0 == "git") {
      j = i + 1; while (j <= NF && $j ~ /^-/) { if ($j == "-c" || $j == "-C") j++; j++ }
      if (j <= NF && isg[$j]) write = 1
    }
    else if (a0 == "find") { for (k = i; k <= NF; k++) if ($k == "-delete" || $k == "-exec" || $k == "-execdir") write = 1 }
    if (!write) next
    for (k = i + 1; k <= NF; k++) { p = check($k); if (p != "") { found = a0 " on " p; next } }
  }
  END { if (found != "") print found }')
if [[ -n "$HIT" ]]; then
  REASON="oh-my-harness: $HIT is blocked: the harness protects its own hooks and runtime config. Edit harness.yaml and run \\\`omh sync\\\` instead."
  _log_event "block" "$REASON"
  _emit_decision "block" "$REASON"
  exit 0
fi
exit 0`,
};
