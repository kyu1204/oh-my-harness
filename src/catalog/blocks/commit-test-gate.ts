import type { BuildingBlock } from "../types.js";

export const commitTestGate: BuildingBlock = {
  id: "commit-test-gate",
  name: "Commit Test Gate",
  description: "Runs tests before git commit and blocks on failure",
  category: "quality",
  event: "PreToolUse",
  matcher: "Bash",
  canBlock: true,
  params: [
    { name: "testCommand", type: "string", description: "Test command to run before commit", required: true },
    {
      name: "cacheTtlSeconds",
      type: "number",
      description: "Skip the run when the working tree is unchanged since the last pass and that pass is younger than this many seconds (0 disables)",
      default: 600,
      required: false,
    },
  ],
  tags: ["git", "test", "quality", "guard"],
  explain: {
    allowOnce: "make the test command pass, or commit only after fixing the failing test",
    change: "harness.yaml > hooks > commit-test-gate: change testCommand or cacheTtlSeconds, set mode: ask, or remove it, then omh sync",
  },
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
if _omh_cmd_matches "$COMMAND" git commit; then
  FP=$(_omh_tree_fingerprint)
  if _omh_gate_cached commit-test-gate {{cacheTtlSeconds}} "$FP"; then
    echo "oh-my-harness: tests already passed on this exact tree; skipping" >&2
    _log_event "allow" "cached: tree unchanged since last passing run"
    exit 0
  fi
  echo "oh-my-harness: Running {{{testCommand}}} before commit..." >&2
  if ! {{{testCommand}}} >&2 2>&1; then
    REASON="oh-my-harness: pre-commit check failed"
    _log_event "block" "$REASON"
    _emit_decision "block" "$REASON"
    exit 0
  fi
  _omh_gate_record commit-test-gate "$FP"
fi
exit 0`,
};
