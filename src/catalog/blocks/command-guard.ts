import type { BuildingBlock } from "../types.js";

export const commandGuard: BuildingBlock = {
  id: "command-guard",
  name: "Command Guard",
  description: "Blocks dangerous shell commands matching specified patterns",
  category: "security",
  event: "PreToolUse",
  matcher: "Bash",
  canBlock: true,
  params: [
    {
      name: "patterns",
      type: "string[]",
      description: "Dangerous command patterns to block",
      default: ["rm -rf /", "rm -rf ~", "sudo rm", "chmod -R 777"],
      required: true,
    },
  ],
  tags: ["security", "bash", "guard", "dangerous"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -z "$COMMAND" ]] && exit 0
PATTERNS=({{#each patterns}}"{{this}}" {{/each}})
for PATTERN in "\${PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qF "$PATTERN"; then
    echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: command matches blocked pattern: $PATTERN\\"}"
    exit 0
  fi
done
exit 0`,
};
