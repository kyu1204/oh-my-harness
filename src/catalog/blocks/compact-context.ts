import type { BuildingBlock } from "../types.js";

export const compactContext: BuildingBlock = {
  id: "compact-context",
  name: "Compact Context",
  description: "Re-injects project context after context compaction",
  category: "automation",
  event: "SessionStart",
  matcher: "compact",
  canBlock: false,
  params: [
    {
      name: "contextFile",
      type: "string",
      description: "Path to the context file to re-inject",
      default: "CLAUDE.md",
      required: false,
    },
  ],
  tags: ["context", "compaction", "session", "automation"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
CONTEXT_FILE="{{{contextFile}}}"
if [[ -f "$CONTEXT_FILE" ]]; then
  cat "$CONTEXT_FILE"
fi
exit 0`,
};
