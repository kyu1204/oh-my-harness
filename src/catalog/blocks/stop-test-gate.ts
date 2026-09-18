import type { BuildingBlock } from "../types.js";

// Stop-event gate (#117): when the agent is about to end its turn with a red
// test suite, hand the failure back so it keeps working instead of finishing
// on a broken tree. Two safety valves: Claude's stop_hook_active flag (a Stop
// hook that blocked once must not block the follow-up stop) and a per-session
// retry cap kept in .omh/state, which also covers runtimes without that flag.
// The tree-fingerprint cache shared with commit-test-gate means a suite that
// just passed on this exact tree is not run again.
export const stopTestGate: BuildingBlock = {
  id: "stop-test-gate",
  name: "Stop Test Gate",
  description: "Runs tests when the agent tries to end its turn and sends it back to work while they fail",
  category: "quality",
  event: "Stop",
  canBlock: true,
  params: [
    { name: "testCommand", type: "string", description: "Test command to run before the turn may end", required: true },
    {
      name: "maxRetries",
      type: "number",
      description: "How many times per session the turn may be sent back before the gate gives up and lets it end",
      default: 2,
      required: false,
    },
    {
      name: "cacheTtlSeconds",
      type: "number",
      description: "Skip the run when the working tree is unchanged since the last pass and that pass is younger than this many seconds (0 disables)",
      default: 600,
      required: false,
    },
  ],
  tags: ["stop", "test", "quality", "gate"],
  explain: {
    allowOnce: "make the test command pass; after maxRetries send-backs in one session the gate lets the turn end anyway",
    change: "harness.yaml > hooks > stop-test-gate: change testCommand, maxRetries or cacheTtlSeconds, or remove it, then omh sync",
  },
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
# A Stop hook that already sent the agent back must not block the follow-up stop.
[[ "$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)" == "true" ]] && exit 0

SESSION=$(echo "$INPUT" | jq -r '.session_id // "default"' 2>/dev/null | tr -c 'A-Za-z0-9_-' '_')
STATE_DIR="\${_OMH_STATE_DIR:-.omh/state}"
COUNT_FILE="$STATE_DIR/stop-test-gate-\${SESSION}.count"
COUNT=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
[[ "$COUNT" =~ ^[0-9]+$ ]] || COUNT=0
if [[ "$COUNT" -ge {{maxRetries}} ]]; then
  _log_event "allow" "stop-test-gate: retry cap ({{maxRetries}}) reached for this session; letting the turn end"
  exit 0
fi

FP=$(_omh_tree_fingerprint)
GATE_CMD=$(cat <<'OMH_GATE_CMD'
{{{testCommand}}}
OMH_GATE_CMD
)
if _omh_gate_cached stop-test-gate {{cacheTtlSeconds}} "$FP" "$GATE_CMD"; then
  rm -f "$COUNT_FILE"
  _log_event "allow" "cached: tree unchanged since last passing run"
  exit 0
fi

STATUS=0
set -o pipefail
ESC=$'\\x1b'
OUTPUT=$(NO_COLOR=1 FORCE_COLOR=0 {{{testCommand}}} 2>&1 | sed "s/\${ESC}\\[[0-9;]*[A-Za-z]//g") || STATUS=$?
if [[ "$STATUS" -ne 0 ]]; then
  mkdir -p "$STATE_DIR" 2>/dev/null || true
  echo $((COUNT + 1)) > "$COUNT_FILE"
  TAIL=$(printf '%s\\n' "$OUTPUT" | tail -n 15)
  REASON="oh-my-harness: the test suite is failing; fix it before ending the turn (attempt $((COUNT + 1))/{{maxRetries}}):
$TAIL"
  _log_event "block" "$REASON"
  jq -cn --arg r "$REASON" '{decision:"block", reason:$r, hookSpecificOutput:{hookEventName:"Stop", decision:"block", reason:$r}}'
  exit 0
fi
rm -f "$COUNT_FILE"
_omh_gate_record stop-test-gate "$FP" "$GATE_CMD"
exit 0`,
};
