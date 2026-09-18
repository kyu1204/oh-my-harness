import type { BuildingBlock } from "../types.js";

export const branchGuard: BuildingBlock = {
  id: "branch-guard",
  name: "Branch Guard",
  description: "Blocks commits on main/master and already-merged branches",
  category: "git",
  event: "PreToolUse",
  matcher: "Bash",
  canBlock: true,
  params: [
    { name: "mainBranch", type: "string", description: "Main branch name", default: "main", required: false },
  ],
  tags: ["git", "branch", "merge", "guard"],
  explain: {
    allowOnce: "create a feature branch (git switch -c feat/x) and commit there",
    change: "harness.yaml > hooks > branch-guard > params.mainBranch, or remove the hook, then omh sync",
  },
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
if _omh_cmd_matches "$COMMAND" git commit || _omh_cmd_matches "$COMMAND" git push; then
  # Where does the commit/push run? Follow cd / pushd and git -C (#133). A repo
  # outside this project is not ours to guard; an unresolvable cwd is treated
  # as the project itself (fail closed).
  GIT_CWD=$(_omh_simple_commands "$COMMAND" | awk -F '\\t' -v root="$_OMH_PROJECT_ROOT" -v home="\${HOME:-}" "\${_OMH_AWK_PATHLIB}"'
    BEGIN { cwd = root }
    found != "" { next }
    { i = 1
      while (i <= NF && $i ~ /^[A-Za-z_][A-Za-z0-9_]*=/) i++
      if (i <= NF && ($i == "sudo" || $i == "doas")) { i++; while (i <= NF && $i ~ /^-/) i++ }
      if (i > NF) next
      if ($i == "cd" || $i == "pushd") { cwd = omh_cd(cwd, (i + 1 <= NF ? $(i + 1) : ""), home); next }
      if ($i != "git") next
      c = cwd; j = i + 1
      while (j <= NF && $j ~ /^-/) { if ($j == "-C") { c = omh_cd(c, $(j + 1), home); j++ } else if ($j == "-c") j++; j++ }
      if (j <= NF && ($j == "commit" || $j == "push")) found = c }
    END { print found }')
  [[ "$GIT_CWD" == "?" || -z "$GIT_CWD" ]] && GIT_CWD="$_OMH_PROJECT_ROOT"
  case "$GIT_CWD" in
    "$_OMH_PROJECT_ROOT"|"$_OMH_PROJECT_ROOT"/*) ;;
    *) exit 0 ;;
  esac
  # A subdirectory of the project is the same repository; if it does not exist yet, ask the root.
  BRANCH=$(git -C "$GIT_CWD" branch --show-current 2>/dev/null || git -C "$_OMH_PROJECT_ROOT" branch --show-current 2>/dev/null)
  [[ -z "$BRANCH" ]] && exit 0
  MAIN='{{mainBranch}}'
  if [[ "$BRANCH" == "$MAIN" ]] || [[ "$BRANCH" == "master" && "$MAIN" == "main" ]]; then
    REASON="oh-my-harness: direct commits to $BRANCH are blocked. Create a feature branch."
    _log_event "block" "$REASON"
    _emit_decision "block" "$REASON"
    exit 0
  fi
  MERGED=0
  if command -v gh >/dev/null 2>&1; then
    COUNT=$(gh pr list --state merged --head "$BRANCH" --json number --jq 'length' 2>/dev/null || echo "")
    if [[ "$COUNT" =~ ^[0-9]+$ ]] && [[ "$COUNT" -gt 0 ]]; then
      MERGED=1
    fi
  fi
  if [[ "$MERGED" -eq 0 ]]; then
    git -C "$GIT_CWD" fetch origin "$MAIN" --quiet >/dev/null 2>&1 || true
    if git -C "$GIT_CWD" branch -r --merged "origin/$MAIN" 2>/dev/null | grep -qE "origin/\${BRANCH}$"; then
      MERGED=1
    fi
  fi
  if [[ "$MERGED" -eq 1 ]]; then
    REASON="oh-my-harness: branch $BRANCH has already been merged to $MAIN. Create a new branch."
    _log_event "block" "$REASON"
    _emit_decision "block" "$REASON"
    exit 0
  fi
fi
exit 0`,
};
