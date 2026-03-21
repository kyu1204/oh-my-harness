import type { BuildingBlock } from "../types.js";

export const sqlGuard: BuildingBlock = {
  id: "sql-guard",
  name: "SQL Guard",
  description: "Blocks dangerous SQL commands in shell",
  category: "security",
  event: "PreToolUse",
  matcher: "Bash",
  canBlock: true,
  params: [
    {
      name: "patterns",
      type: "string[]",
      description: "Dangerous SQL patterns to block",
      default: ["DROP TABLE", "DROP DATABASE", "TRUNCATE TABLE", "DELETE FROM", "ALTER TABLE.*DROP"],
      required: true,
    },
  ],
  tags: ["security", "sql", "guard", "database"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -z "$COMMAND" ]] && exit 0
COMMAND_LOWER=$(echo "$COMMAND" | tr '[:upper:]' '[:lower:]')
PATTERNS=({{#each patterns}}"{{{this}}}" {{/each}})
for PATTERN in "\${PATTERNS[@]}"; do
  PATTERN_LOWER=$(echo "$PATTERN" | tr '[:upper:]' '[:lower:]')
  if echo "$COMMAND_LOWER" | grep -qF -- "$PATTERN_LOWER"; then
    echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: SQL command matches blocked pattern: $PATTERN\\"}"
    exit 0
  fi
done
exit 0`,
};
