import type { BuildingBlock } from "../types.js";

export const testOnSave: BuildingBlock = {
  id: "test-on-save",
  name: "Test on Save",
  description: "Runs related tests after source file edits",
  category: "quality",
  event: "PostToolUse",
  matcher: "Edit|Write",
  canBlock: false,
  params: [
    {
      name: "testCommand",
      type: "string",
      description: "Command to run tests (e.g. npx vitest run)",
      required: true,
    },
    {
      name: "filePattern",
      type: "string",
      description: "Regex pattern to match source files",
      default: "\\.(ts|tsx|js|jsx|py)$",
      required: false,
    },
  ],
  tags: ["quality", "testing", "auto-run", "save"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
[[ -z "$FILE_PATH" ]] && exit 0
FILE_RE='{{{filePattern}}}'
FILE_RE="\${FILE_RE//\\\\\\\\/\\\\}"
if [[ "$FILE_PATH" =~ $FILE_RE ]]; then
  echo "oh-my-harness: Running tests after edit..." >&2
  {{{testCommand}}} >&2 2>&1 || true
fi
exit 0`,
};
