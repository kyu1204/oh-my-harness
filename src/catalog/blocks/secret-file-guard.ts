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
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
FILE_PATHS=()
DIRECT_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
[[ -n "$DIRECT_PATH" ]] && FILE_PATHS+=("$DIRECT_PATH")
if [[ "$TOOL_NAME" == "apply_patch" ]]; then
  PATCH_TEXT=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
  if [[ -n "$PATCH_TEXT" ]]; then
    while IFS= read -r _OMH_HEADER_PATH; do
      # CRLF patches leave a trailing \\r since sed's $ matches before \\n
      # only; strip it so basename/path comparisons aren't bypassed.
      _OMH_HEADER_PATH="\${_OMH_HEADER_PATH%$'\\r'}"
      [[ -n "$_OMH_HEADER_PATH" ]] && FILE_PATHS+=("$_OMH_HEADER_PATH")
    done < <(printf '%s\\n' "$PATCH_TEXT" | sed -nE 's/^\\*\\*\\* (Add|Update|Delete) File: (.+)$/\\2/p')
  fi
fi
[[ \${#FILE_PATHS[@]} -eq 0 ]] && exit 0

PATTERNS=({{#each patterns}}"{{{this}}}" {{/each}})
for FILE_PATH in "\${FILE_PATHS[@]}"; do
  BASENAME=$(basename "$FILE_PATH")
  for PATTERN in "\${PATTERNS[@]}"; do
    if [[ "$BASENAME" == $PATTERN ]]; then
      REASON="oh-my-harness: file $BASENAME matches secret file pattern: $PATTERN"
      _log_event "block" "$REASON"
      _emit_decision "block" "$REASON"
      exit 0
    fi
  done
done
exit 0`,
};
