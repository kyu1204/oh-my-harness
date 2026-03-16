import type { BuildingBlock } from "../types.js";

export const commitTestGate: BuildingBlock = {
  id: "commit-test-gate",
  name: "Commit Test Gate",
  description: "Runs tests before git commit and blocks on failure",
  category: "quality",
  event: "PreToolUse",
  matcher: "Bash",
  canBlock: true,
  params: [
    { name: "testCommand", type: "string", description: "Test command to run before commit", required: true },
  ],
  tags: ["git", "test", "quality", "guard"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
if echo "$COMMAND" | grep -qE "git commit"; then
  echo "oh-my-harness: Running {{testCommand}} before commit..." >&2
  if ! {{testCommand}} >&2 2>&1; then
    echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: pre-commit check failed\\"}"
    exit 0
  fi
fi
exit 0`,
};
