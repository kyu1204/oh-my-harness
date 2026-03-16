import type { BuildingBlock } from "../types.js";

export const formatOnSave: BuildingBlock = {
  id: "format-on-save",
  name: "Format on Save",
  description: "Runs a formatter on files after they are saved",
  category: "auto-fix",
  event: "PostToolUse",
  matcher: "Edit|Write",
  canBlock: false,
  params: [
    {
      name: "filePattern",
      type: "string",
      description: "Glob pattern of files to format (e.g. *.py)",
      required: true,
    },
    {
      name: "command",
      type: "string",
      description: "Format command to run (e.g. ruff format)",
      required: true,
    },
  ],
  tags: ["format", "auto-fix", "quality", "save"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
[[ -z "$FILE_PATH" ]] && exit 0
PATTERN="{{filePattern}}"
BASENAME=$(basename "$FILE_PATH")
if [[ "$BASENAME" == $PATTERN ]]; then
  echo "oh-my-harness: Running {{command}} on $FILE_PATH..." >&2
  {{command}} "$FILE_PATH" >&2 2>&1 || true
fi
exit 0`,
};
