import type { BuildingBlock } from "../types.js";

export const pathGuard: BuildingBlock = {
  id: "path-guard",
  name: "Path Guard",
  description: "Blocks edits or writes to specified paths or directories",
  category: "file-protection",
  event: "PreToolUse",
  matcher: "Edit|Write",
  canBlock: true,
  params: [
    {
      name: "blockedPaths",
      type: "string[]",
      description: "Paths or directory prefixes to block (e.g. dist/, node_modules/)",
      required: true,
    },
  ],
  tags: ["security", "file", "path", "guard"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
[[ -z "$FILE_PATH" ]] && exit 0
BLOCKED_PATHS=({{#each blockedPaths}}"{{this}}" {{/each}})
for BLOCKED in "\${BLOCKED_PATHS[@]}"; do
  if [[ "$BLOCKED" == */ ]]; then
    if [[ "$FILE_PATH" == "$BLOCKED"* || "$FILE_PATH" == *"/$BLOCKED"* ]]; then
      echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: file path matches blocked directory: $BLOCKED\\"}"
      exit 0
    fi
  elif [[ "$BLOCKED" == \\** ]]; then
    PATTERN="\${BLOCKED#\\*}"
    if [[ "$FILE_PATH" == *"$PATTERN" ]]; then
      echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: file path matches blocked pattern: $BLOCKED\\"}"
      exit 0
    fi
  else
    if [[ "$FILE_PATH" == "$BLOCKED" || "$FILE_PATH" == *"/$BLOCKED" ]]; then
      echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: file path matches blocked path: $BLOCKED\\"}"
      exit 0
    fi
  fi
done
exit 0`,
};
