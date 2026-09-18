import type { BuildingBlock } from "../types.js";

// Closes the hook-bypass hole (#98, first reported in #27): commit-test-gate
// and friends are PreToolUse hooks, but git's own pre-commit / pre-push hooks
// are a second line teams rely on, and an agent that learns "--no-verify"
// makes them vanish. Blocked forms, on any simple command that is `git commit`
// or `git push` (through env/sudo/sh -c, see #109/#110):
//   git commit --no-verify | -n | any short cluster containing n (-anm, -qn)
//   git push --no-verify
//   git -c core.hooksPath=... <anything>   (points hooks at an empty dir; key match is case-insensitive)
//   GIT_CONFIG_KEY_n=core.hooksPath ... git  and GIT_CONFIG_PARAMETERS='core.hooksPath=...' git
// `git push -n` is dry-run, not no-verify, so it stays allowed.
export const noVerifyGuard: BuildingBlock = {
  id: "no-verify-guard",
  name: "No-Verify Guard",
  description: "Blocks git commit/push that bypass git hooks (--no-verify, -n, core.hooksPath override)",
  category: "git",
  event: "PreToolUse",
  matcher: "Bash",
  canBlock: true,
  params: [],
  tags: ["git", "hooks", "guard", "bypass"],
  explain: {
    allowOnce: "fix what the git hook reports and commit or push again without --no-verify",
    change: "harness.yaml > hooks > no-verify-guard: set mode: ask or remove it, then omh sync",
  },
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -z "$COMMAND" ]] && exit 0

HIT=$(_omh_simple_commands "$COMMAND" | awk -F '\\t' '
  found != "" { next }
  {
    i = 1
    env_bypass = 0
    while (i <= NF && $i ~ /^[A-Za-z_][A-Za-z0-9_]*=/) {
      # GIT_CONFIG_KEY_n=core.hooksPath / GIT_CONFIG_PARAMETERS='core.hooksPath=...' disable hooks too
      lw = tolower($i)
      if (lw ~ /^git_config_key_[0-9]+=core\\.hookspath$/ || lw ~ /^git_config_parameters=.*core\\.hookspath=/) env_bypass = 1
      i++
    }
    if (i <= NF && ($i == "sudo" || $i == "doas")) { i++; while (i <= NF && $i ~ /^-/) i++ }
    if (i > NF || $i != "git") next
    if (env_bypass) { found = "GIT_CONFIG core.hooksPath override"; next }
    # global options before the subcommand; -c core.hooksPath=... is itself a bypass (config keys are case-insensitive)
    j = i + 1
    while (j <= NF && $j ~ /^-/) {
      if ($j == "-c" || $j == "-C") {
        if ($j == "-c" && j + 1 <= NF && tolower($(j + 1)) ~ /^core\\.hookspath=/) { found = "git -c core.hooksPath override"; next }
        j++
      }
      j++
    }
    if (j > NF) next
    sub_cmd = $j
    if (sub_cmd != "commit" && sub_cmd != "push") next
    for (k = j + 1; k <= NF; k++) {
      if ($k == "--") break
      if ($k == "--no-verify") { found = "git " sub_cmd " --no-verify"; next }
      if (sub_cmd == "commit" && $k ~ /^-[A-Za-z]*n[A-Za-z]*$/) { found = "git commit -n (no-verify)"; next }
      if (sub_cmd == "commit" && $k == "-m") k++
    }
  }
  END { if (found != "") print found }')

if [[ -n "$HIT" ]]; then
  REASON="oh-my-harness: $HIT is blocked: git hooks are part of the harness. Fix what the hook reports instead of skipping it."
  _log_event "block" "$REASON"
  _emit_decision "block" "$REASON"
  exit 0
fi
exit 0`,
};
