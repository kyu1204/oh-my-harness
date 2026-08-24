import type { BuildingBlock } from "../types.js";

/**
 * Enforces the loop protocol's two deterministic bans as hard blocks instead
 * of prose. Both have been violated in practice when they lived only in a
 * ledger: a loop that writes its own work order and then implements it is
 * approving itself, and architect-only files are exactly the ones a loop
 * mis-diagnoses. Fires only in loop sessions — the runner exports OMH_LOOP=1,
 * so the architect's own session is never blocked.
 */
export const loopGuard: BuildingBlock = {
  id: "loop-guard",
  name: "Loop Guard",
  description: "Blocks a loop session from writing its own work orders or touching architect-only paths",
  category: "quality",
  event: "PreToolUse",
  matcher: "Edit|Write",
  canBlock: true,
  params: [
    {
      name: "workOrders",
      type: "string",
      description: "Work-order directory the loop must never write into",
      required: false,
      default: "docs/work-orders",
    },
    {
      name: "architectOnly",
      type: "string[]",
      description: "Path prefixes only the architect may edit",
      required: false,
      default: [],
    },
  ],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)

# Architect sessions pass through untouched; only the runner exports this.
[[ "\${OMH_LOOP:-}" != "1" ]] && exit 0

FILE_PATH=$(echo "\$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
[[ -z "\$FILE_PATH" ]] && exit 0

# Component-boundary matching: wrap both sides in slashes so 'ios' matches
# ios/App.swift and /repo/ios/... but never src/kiosk.ts.
_omh_path_under() {
  local file="/\$1/" prefix="\${2%/}"
  [[ "\$file" == *"/\$prefix/"* ]]
}

WORK_ORDERS='{{{workOrders}}}'
if _omh_path_under "\$FILE_PATH" "\$WORK_ORDERS"; then
  REASON="oh-my-harness: loop-guard — the loop must not write its own work orders. Mark the task 'BLOCKED: no work order' and move on; the architect writes work orders."
  _log_event "block" "\$REASON"
  _emit_decision "block" "\$REASON"
  exit 0
fi

ARCHITECT_ONLY=({{#each architectOnly}}"{{{this}}}" {{/each}})
for prefix in "\${ARCHITECT_ONLY[@]+"\${ARCHITECT_ONLY[@]}"}"; do
  [[ -z "\$prefix" ]] && continue
  if _omh_path_under "\$FILE_PATH" "\$prefix"; then
    REASON="oh-my-harness: loop-guard — \$prefix is architect-only. Mark the task 'BLOCKED: architect-only path' and move on."
    _log_event "block" "\$REASON"
    _emit_decision "block" "\$REASON"
    exit 0
  fi
done

exit 0`,
  tags: ["loop", "autonomous", "quality", "guardrail"],
};
