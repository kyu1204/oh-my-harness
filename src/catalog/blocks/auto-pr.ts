import type { BuildingBlock } from "../types.js";

export const autoPr: BuildingBlock = {
  id: "auto-pr",
  name: "Auto PR",
  description: "Automatically creates a pull request after a git push if one does not already exist",
  category: "automation",
  event: "PostToolUse",
  matcher: "Bash",
  canBlock: false,
  params: [
    {
      name: "baseBranch",
      type: "string",
      description: "Base branch for the pull request",
      default: "main",
      required: false,
    },
    {
      name: "draft",
      type: "boolean",
      description: "Create the pull request as a draft",
      default: false,
      required: false,
    },
  ],
  tags: ["git", "pr", "automation", "github"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -z "$COMMAND" ]] && exit 0
if ! echo "$COMMAND" | grep -q "git push"; then
  exit 0
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "oh-my-harness: gh CLI not found, skipping auto-pr" >&2
  exit 0
fi
BRANCH=$(git branch --show-current 2>/dev/null)
[[ -z "$BRANCH" ]] && exit 0
BASE="{{baseBranch}}"
[[ "$BRANCH" == "$BASE" ]] && exit 0
EXISTING=$(gh pr list --head "$BRANCH" --base "$BASE" --json number --jq 'length' 2>/dev/null || echo 0)
if [[ "$EXISTING" -gt 0 ]]; then
  echo "oh-my-harness: PR already exists for branch $BRANCH, skipping" >&2
  exit 0
fi
DRAFT_FLAG=""
if [[ "{{draft}}" == "true" ]]; then
  DRAFT_FLAG="--draft"
fi
echo "oh-my-harness: Creating PR for branch $BRANCH -> $BASE..." >&2
gh pr create --base "$BASE" --head "$BRANCH" --fill $DRAFT_FLAG >&2 2>&1 || true
exit 0`,
};
