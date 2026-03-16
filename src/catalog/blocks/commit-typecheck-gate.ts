import type { BuildingBlock } from "../types.js";

export const commitTypecheckGate: BuildingBlock = {
  id: "commit-typecheck-gate",
  name: "Commit Typecheck Gate",
  description: "Runs type checking before git commit and blocks on failure",
  category: "quality",
  event: "PreToolUse",
  matcher: "Bash",
  canBlock: true,
  params: [
    { name: "typecheckCommand", type: "string", description: "Typecheck command to run before commit", required: true },
  ],
  tags: ["git", "typecheck", "quality", "guard"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
if echo "$COMMAND" | grep -qE "git commit"; then
  echo "oh-my-harness: Running {{typecheckCommand}} before commit..." >&2
  if ! {{typecheckCommand}} >&2 2>&1; then
    echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: pre-commit check failed\\"}"
    exit 0
  fi
fi
exit 0`,
};
