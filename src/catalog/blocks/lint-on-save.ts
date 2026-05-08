import type { BuildingBlock } from "../types.js";

export const lintOnSave: BuildingBlock = {
  id: "lint-on-save",
  name: "Lint on Save",
  description: "Runs a linter on files after they are saved",
  category: "auto-fix",
  event: "PostToolUse",
  matcher: "Edit|Write",
  canBlock: false,
  params: [
    {
      name: "filePattern",
      type: "string",
      description: "Glob pattern of files to lint (e.g. *.ts)",
      required: true,
    },
    {
      name: "command",
      type: "string",
      description: "Lint command to run (e.g. eslint --fix)",
      required: true,
    },
    {
      name: "scope",
      type: "string",
      description:
        "Lint scope: 'file' passes $FILE_PATH to command, 'module' runs command without file arg",
      required: false,
      default: "file",
    },
  ],
  tags: ["lint", "auto-fix", "quality", "save"],
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
    done < <(printf '%s\\n' "$PATCH_TEXT" | sed -nE 's/^\\*\\*\\* (Add|Update) File: (.+)$/\\2/p')
  fi
fi
[[ \${#FILE_PATHS[@]} -eq 0 ]] && exit 0

PATTERN='{{{filePattern}}}'
SCOPE='{{{scope}}}'
_OMH_RAN_MODULE=0
for FILE_PATH in "\${FILE_PATHS[@]}"; do
  BASENAME=$(basename "$FILE_PATH")
  if [[ "$BASENAME" == $PATTERN ]]; then
    if [[ "\${SCOPE:-file}" == "module" ]]; then
      if [[ "$_OMH_RAN_MODULE" -eq 0 ]]; then
        echo "oh-my-harness: Running {{{command}}} ..." >&2
        {{{command}}} >&2 || true
        _OMH_RAN_MODULE=1
      fi
    else
      echo "oh-my-harness: Running {{{command}}} on $FILE_PATH..." >&2
      {{{command}}} "$FILE_PATH" >&2 || true
    fi
  fi
done
exit 0`,
};
