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
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
[[ -z "$FILE_PATH" ]] && exit 0
BASENAME=$(basename "$FILE_PATH")
LOCKFILES=({{#each lockfiles}}"{{this}}" {{/each}})
for LOCKFILE in "\${LOCKFILES[@]}"; do
  if [[ "$BASENAME" == "$LOCKFILE" ]]; then
    echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: direct edits to lockfile $BASENAME are blocked. Use the package manager instead.\\"}"
    exit 0
  fi
done
exit 0`,
};
