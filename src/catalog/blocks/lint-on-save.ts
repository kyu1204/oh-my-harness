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
  ],
  tags: ["lint", "auto-fix", "quality", "save"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[[ -z "$FILE_PATH" ]] && exit 0
PATTERN="{{filePattern}}"
BASENAME=$(basename "$FILE_PATH")
if [[ "$BASENAME" == $PATTERN ]]; then
  echo "oh-my-harness: Running {{command}} on $FILE_PATH..." >&2
  {{command}} "$FILE_PATH" >&2 2>&1 || true
fi
exit 0`,
};
