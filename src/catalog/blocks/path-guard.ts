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
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
# Collect file paths. Claude Edit/Write expose tool_input.file_path directly;
# Codex apply_patch ships the patch text in tool_input.command and encodes
# paths in "*** {Add|Update|Delete} File: <path>" headers.
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

BLOCKED_PATHS=({{#each blockedPaths}}"{{{this}}}" {{/each}})
for FILE_PATH in "\${FILE_PATHS[@]}"; do
  # Normalize each path to prevent directory traversal attacks (e.g., ./foo/../dist/secret.js -> dist/secret.js)
  if command -v python3 >/dev/null 2>&1; then
    if ! NORMALIZED=$(python3 -c "import os,sys; print(os.path.normpath(sys.argv[1]))" "$FILE_PATH" 2>/dev/null); then
      REASON="oh-my-harness: path normalization unavailable for non-canonical path"
      _log_event "block" "$REASON"
      _emit_decision "block" "$REASON"
      exit 0
    fi
  else
    case "$FILE_PATH" in
      /*|../*|*/../*|*/..|./*|*/./*|*/.)
        REASON="oh-my-harness: path normalization unavailable for non-canonical path"
        _log_event "block" "$REASON"
        _emit_decision "block" "$REASON"
        exit 0
        ;;
    esac
    NORMALIZED="$FILE_PATH"
  fi
  for BLOCKED in "\${BLOCKED_PATHS[@]}"; do
    if [[ "$BLOCKED" == */ ]]; then
      if [[ "$NORMALIZED" == "$BLOCKED"* || "$NORMALIZED" == *"/$BLOCKED"* ]]; then
        REASON="oh-my-harness: file path matches blocked directory: $BLOCKED"
        _log_event "block" "$REASON"
        _emit_decision "block" "$REASON"
        exit 0
      fi
    elif [[ "$BLOCKED" == \\** ]]; then
      PATTERN="\${BLOCKED#\\*}"
      if [[ "$NORMALIZED" == *"$PATTERN" ]]; then
        REASON="oh-my-harness: file path matches blocked pattern: $BLOCKED"
        _log_event "block" "$REASON"
        _emit_decision "block" "$REASON"
        exit 0
      fi
    else
      if [[ "$NORMALIZED" == "$BLOCKED" || "$NORMALIZED" == *"/$BLOCKED" ]]; then
        REASON="oh-my-harness: file path matches blocked path: $BLOCKED"
        _log_event "block" "$REASON"
        _emit_decision "block" "$REASON"
        exit 0
      fi
    fi
  done
done
exit 0`,
};
