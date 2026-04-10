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
# Normalize path to prevent directory traversal attacks (e.g., ./foo/../dist/secret.js -> dist/secret.js)
if command -v python3 >/dev/null 2>&1; then
  if ! NORMALIZED=$(python3 -c "import os,sys; print(os.path.normpath(sys.argv[1]))" "$FILE_PATH" 2>/dev/null); then
    _log_event "block" "oh-my-harness: path normalization unavailable for non-canonical path"
    echo "{\\"decision\\": \\\"block\\\", \\\"reason\\\": \\\"oh-my-harness: path normalization unavailable for non-canonical path\\\"}"
    exit 0
  fi
else
  case "$FILE_PATH" in
    /*|../*|*/../*|*/..|./*|*/./*|*/.)
      _log_event "block" "oh-my-harness: path normalization unavailable for non-canonical path"
      echo "{\\"decision\\": \\\"block\\\", \\\"reason\\\": \\\"oh-my-harness: path normalization unavailable for non-canonical path\\\"}"
      exit 0
      ;;
  esac
  NORMALIZED="$FILE_PATH"
fi
BLOCKED_PATHS=({{#each blockedPaths}}"{{{this}}}" {{/each}})
for BLOCKED in "\${BLOCKED_PATHS[@]}"; do
  if [[ "$BLOCKED" == */ ]]; then
    if [[ "$NORMALIZED" == "$BLOCKED"* || "$NORMALIZED" == *"/$BLOCKED"* ]]; then
      _log_event "block" "oh-my-harness: file path matches blocked directory: $BLOCKED"
      echo "{\\"decision\\": \\\"block\\\", \\\"reason\\\": \\\"oh-my-harness: file path matches blocked directory: $BLOCKED\\\"}"
      exit 0
    fi
  elif [[ "$BLOCKED" == \\** ]]; then
    PATTERN="\${BLOCKED#\\*}"
    if [[ "$NORMALIZED" == *"$PATTERN" ]]; then
      _log_event "block" "oh-my-harness: file path matches blocked pattern: $BLOCKED"
      echo "{\\"decision\\": \\\"block\\\", \\\"reason\\\": \\\"oh-my-harness: file path matches blocked pattern: $BLOCKED\\\"}"
      exit 0
    fi
  else
    if [[ "$NORMALIZED" == "$BLOCKED" || "$NORMALIZED" == *"/$BLOCKED" ]]; then
      _log_event "block" "oh-my-harness: file path matches blocked path: $BLOCKED"
      echo "{\\"decision\\": \\\"block\\\", \\\"reason\\\": \\\"oh-my-harness: file path matches blocked path: $BLOCKED\\\"}"
      exit 0
    fi
  fi
done
exit 0`,
};
