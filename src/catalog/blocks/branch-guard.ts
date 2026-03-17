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
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
if echo "$COMMAND" | grep -qE "git commit|git push"; then
  BRANCH=$(git branch --show-current 2>/dev/null)
  [[ -z "$BRANCH" ]] && exit 0
  MAIN='{{mainBranch}}'
  if [[ "$BRANCH" == "$MAIN" ]] || [[ "$BRANCH" == "master" && "$MAIN" == "main" ]]; then
    _log_event "block" "oh-my-harness: direct commits to $BRANCH are blocked. Create a feature branch."
    echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: direct commits to $BRANCH are blocked. Create a feature branch.\\"}"
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
    git fetch origin "$MAIN" --quiet >/dev/null 2>&1 || true
    if git branch -r --merged "origin/$MAIN" 2>/dev/null | grep -qE "origin/\${BRANCH}$"; then
      MERGED=1
    fi
  fi
  if [[ "$MERGED" -eq 1 ]]; then
    _log_event "block" "oh-my-harness: branch $BRANCH has already been merged to $MAIN. Create a new branch."
    echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: branch $BRANCH has already been merged to $MAIN. Create a new branch.\\"}"
    exit 0
  fi
fi
exit 0`,
};
