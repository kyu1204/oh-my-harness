import type { BuildingBlock } from "../types.js";

// Rules become enforceable (#144). For every Bash / Edit / Write call, ask
// Jev one yes/no question per enforced rule ("does this tool call violate
// the rule?") in a single fan-out request and act on the calibrated
// probability: block at or above blockAbove, ask in the middle band (on
// runtimes with ask; elsewhere allow and log a warning), allow below.
// This layer is additive: no key, no curl, an API error or a timeout all
// mean "allow and log skipped". It never relaxes a deterministic guard.
// State sent to Jev is the tool input only (command, path, truncated text).
export const semanticRuleGuard: BuildingBlock = {
  id: "semantic-rule-guard",
  name: "Semantic Rule Guard",
  description: "Judges every Bash/Edit/Write call against your enforced rules with Jev and blocks clear violations",
  category: "security",
  event: "PreToolUse",
  matcher: "Bash|Edit|Write|MultiEdit",
  canBlock: true,
  params: [
    { name: "rules", type: "string[]", description: "Rule statements to enforce (filled from rules marked enforce: true)", required: true },
    { name: "blockAbove", type: "number", description: "Block when the violation probability is at or above this", default: 0.9, required: false },
    { name: "askAbove", type: "number", description: "Ask for confirmation when the probability is at or above this (below blockAbove)", default: 0.6, required: false },
  ],
  tags: ["semantic", "jev", "rules", "guard"],
  explain: {
    allowOnce: "rewrite the call so it clearly does not do what the rule forbids, or answer the ask prompt",
    change: "harness.yaml > rules: remove enforce: true from the rule, or edit its text; thresholds live under hooks > semantic-rule-guard (blockAbove / askAbove), then omh sync",
  },
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
case "$TOOL" in Bash|Edit|Write|MultiEdit) ;; *) exit 0 ;; esac

KEY="\${TYPESAFE_API_KEY:-}"
if [[ -z "$KEY" && -f "$_OMH_PROJECT_ROOT/.env" ]]; then
  KEY=$(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?TYPESAFE_API_KEY[[:space:]]*=[[:space:]]*"?([^"#[:space:]]+)"?.*/\\2/p' "$_OMH_PROJECT_ROOT/.env" | head -n 1)
fi
if [[ -z "$KEY" ]]; then _log_event "allow" "skipped: no TYPESAFE_API_KEY"; exit 0; fi
command -v curl >/dev/null 2>&1 || { _log_event "allow" "skipped: curl not found"; exit 0; }

# Rules arrive through a quoted heredoc so any characters survive; one rule per separator.
RULES_RAW=$(cat <<'OMH_RULES'
{{#each rules}}{{{this}}}
OMH_RULES_SEP
{{/each}}
OMH_RULES
)
RULES_JSON=$(printf '%s' "$RULES_RAW" | jq -Rs 'rtrimstr("\\nOMH_RULES_SEP") | split("\\nOMH_RULES_SEP\\n") | map(select(. != ""))')
[[ "$(echo "$RULES_JSON" | jq 'length')" -gt 0 ]] || exit 0

STATE=$(echo "$INPUT" | jq -c '{
  tool: .tool_name,
  command: .tool_input.command,
  description: .tool_input.description,
  file_path: .tool_input.file_path,
  old_string: ((.tool_input.old_string // "") | .[0:2000]),
  new_string: ((.tool_input.new_string // "") | .[0:4000]),
  content: ((.tool_input.content // "") | .[0:4000])
} | with_entries(select(.value != null and .value != ""))')
BODY=$(jq -cn --argjson state "$STATE" --argjson rules "$RULES_JSON" '{
  model: "jev-latest", state: $state,
  questions: ($rules | to_entries | map({
    key: ("rule:" + ((.key + 1) | tostring)),
    value: {type: "noul", instructions: ("Does this tool call violate the following project rule? Rule: " + .value + " Answer yes only if the call clearly does what the rule forbids.")}
  }) | from_entries)}')

RESP=$(curl -sS -m 10 -X POST "\${OMH_TYPESAFE_ENDPOINT:-https://api.typesafe.ai/v1/systemone}" \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" --data-binary "$BODY" -w '\\n%{http_code}' 2>/dev/null) || RESP=$'\\n000'
CODE="\${RESP##*$'\\n'}"; RESP="\${RESP%$'\\n'*}"
if [[ "$CODE" != "200" ]]; then _log_event "allow" "skipped: TypeSafe API $CODE"; exit 0; fi

TOP=$(echo "$RESP" | jq -r '[.answers // {} | to_entries[] | select(.value.type == "noul") | {i: (.key | ltrimstr("rule:") | tonumber), p: .value.noul}] | max_by(.p) // empty | "\\(.i) \\(.p)"')
[[ -z "$TOP" ]] && { _log_event "allow" "skipped: no answers"; exit 0; }
IDX="\${TOP%% *}"; P="\${TOP#* }"
RULE=$(echo "$RULES_JSON" | jq -r --argjson i "$IDX" '.[$i - 1]')
PSHORT=$(printf '%.2f' "$P")
BLOCK_AT={{blockAbove}}
ASK_AT={{askAbove}}
if awk -v p="$P" -v t="$BLOCK_AT" 'BEGIN { exit !(p >= t) }'; then
  REASON="oh-my-harness: this call violates an enforced rule (p=$PSHORT): $RULE"
  _log_event "block" "$REASON"
  _emit_decision "block" "$REASON"
  exit 0
fi
if awk -v p="$P" -v t="$ASK_AT" 'BEGIN { exit !(p >= t) }'; then
  REASON="oh-my-harness: this call may violate an enforced rule (p=$PSHORT): $RULE"
  if printf '%s' "$INPUT" | jq -e 'has("transcript_path")' >/dev/null 2>&1; then
    _log_event "allow" "ask: $REASON"
    jq -cn --arg reason "$REASON" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:$reason}}'
  else
    _log_event "allow" "warn: $REASON"
  fi
  exit 0
fi
exit 0`,
};
