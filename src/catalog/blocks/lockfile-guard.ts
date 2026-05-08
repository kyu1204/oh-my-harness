import type { BuildingBlock } from "../types.js";

export const lockfileGuard: BuildingBlock = {
  id: "lockfile-guard",
  name: "Lockfile Guard",
  description: "Blocks direct edits to lockfiles (package-lock.json, yarn.lock, etc.)",
  category: "file-protection",
  event: "PreToolUse",
  matcher: "Edit|Write",
  canBlock: true,
  params: [
    {
      name: "lockfiles",
      type: "string[]",
      description: "Lockfile names to protect",
      default: ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Pipfile.lock", "poetry.lock"],
      required: false,
    },
  ],
  tags: ["security", "file", "lockfile", "guard"],
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
      [[ -n "$_OMH_HEADER_PATH" ]] && FILE_PATHS+=("$_OMH_HEADER_PATH")
    done < <(printf '%s\\n' "$PATCH_TEXT" | sed -nE 's/^\\*\\*\\* (Add|Update|Delete) File: (.+)$/\\2/p')
  fi
fi
[[ \${#FILE_PATHS[@]} -eq 0 ]] && exit 0

LOCKFILES=({{#each lockfiles}}"{{{this}}}" {{/each}})
for FILE_PATH in "\${FILE_PATHS[@]}"; do
  BASENAME=$(basename "$FILE_PATH")
  for LOCKFILE in "\${LOCKFILES[@]}"; do
    if [[ "$BASENAME" == "$LOCKFILE" ]]; then
      REASON="oh-my-harness: direct edits to lockfile $BASENAME are blocked. Use the package manager instead."
      _log_event "block" "$REASON"
      _emit_decision "block" "$REASON"
      exit 0
    fi
  done
done
exit 0`,
};
