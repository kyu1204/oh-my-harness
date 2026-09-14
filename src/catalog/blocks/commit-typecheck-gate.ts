import type { BuildingBlock } from "../types.js";

export const commitTypecheckGate: BuildingBlock = {
  id: "commit-typecheck-gate",
  name: "Commit Typecheck Gate",
  description: "Runs type checking before git commit and blocks on failure",
  category: "quality",
  event: "PreToolUse",
  matcher: "Bash",
  canBlock: true,
  params: [
    { name: "typecheckCommand", type: "string", description: "Typecheck command to run before commit", required: true },
    {
      name: "cacheTtlSeconds",
      type: "number",
      description: "Skip the run when the working tree is unchanged since the last pass and that pass is younger than this many seconds (0 disables)",
      default: 600,
      required: false,
    },
  ],
  tags: ["git", "typecheck", "quality", "guard"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
if _omh_cmd_matches "$COMMAND" git commit; then
  if _omh_gate_cached commit-typecheck-gate {{cacheTtlSeconds}}; then
    echo "oh-my-harness: typecheck already passed on this exact tree; skipping" >&2
    _log_event "allow" "cached: tree unchanged since last passing run"
    exit 0
  fi
  echo "oh-my-harness: Running {{{typecheckCommand}}} before commit..." >&2
  if ! {{{typecheckCommand}}} >&2 2>&1; then
    REASON="oh-my-harness: pre-commit check failed"
    _log_event "block" "$REASON"
    _emit_decision "block" "$REASON"
    exit 0
  fi
  _omh_gate_record commit-typecheck-gate
fi
exit 0`,
};
