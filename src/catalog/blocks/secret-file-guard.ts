import type { BuildingBlock } from "../types.js";

export const secretFileGuard: BuildingBlock = {
  id: "secret-file-guard",
  name: "Secret File Guard",
  description: "Blocks edits to files that may contain secrets or credentials",
  category: "security",
  event: "PreToolUse",
  matcher: "Edit|Write",
  canBlock: true,
  params: [
    {
      name: "patterns",
      type: "string[]",
      description: "Filename patterns to block (e.g. .env, *.pem)",
      default: [".env", ".env.*", "credentials.json", "*.pem", "*.key"],
      required: false,
    },
  ],
  tags: ["security", "secrets", "credentials", "guard"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
[[ -z "$FILE_PATH" ]] && exit 0
BASENAME=$(basename "$FILE_PATH")
PATTERNS=({{#each patterns}}"{{this}}" {{/each}})
for PATTERN in "\${PATTERNS[@]}"; do
  if [[ "$BASENAME" == $PATTERN ]]; then
    echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: file $BASENAME matches secret file pattern: $PATTERN\\"}"
    exit 0
  fi
done
exit 0`,
};
