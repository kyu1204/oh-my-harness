import type { BuildingBlock } from "../types.js";

// Semantic lint of the staged diff before a commit (#145), powered by jgrep
// (https://github.com/kyu1204/jgrep): `jgrep --json --diff --staged "<rule>"`
// asks Jev, hunk by hunk, whether the change does what the rule describes.
// Any hit blocks the commit with file:line ranges. jgrep is optional by
// construction: it is called through PATH, never bundled; when it is not
// installed (or fails) the gate allows and logs why, so a harness without
// jgrep behaves exactly as before.
export const semanticDiffGate: BuildingBlock = {
  id: "semantic-diff-gate",
  name: "Semantic Diff Gate",
  description: "Before git commit, lints the staged diff with jgrep against rule descriptions and blocks on a hit (needs jgrep on PATH)",
  category: "quality",
  event: "PreToolUse",
  matcher: "Bash",
  canBlock: true,
  params: [
    { name: "rules", type: "string[]", description: "English descriptions of changes that must not be committed (filled from rules with a lint: field)", required: true },
    { name: "threshold", type: "number", description: "jgrep probability threshold for a hit", default: 0.85, required: false },
    { name: "jgrep", type: "string", description: "jgrep command", default: "jgrep", required: false },
  ],
  tags: ["semantic", "jev", "jgrep", "diff", "lint", "gate"],
  explain: {
    allowOnce: "change the staged hunks jgrep pointed at (file:line in the reason), or unstage them",
    change: "harness.yaml > rules: drop or edit the lint: description; threshold lives under hooks > semantic-diff-gate; uninstalling jgrep disables the gate, then omh sync",
  },
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -z "$COMMAND" ]] && exit 0
_omh_cmd_matches "$COMMAND" git commit || exit 0

JGREP='{{{jgrep}}}'
if ! command -v "$JGREP" >/dev/null 2>&1; then
  _log_event "allow" "skipped: jgrep not found (npm i -g jevgrep && jgrep init to enable the semantic diff gate)"
  exit 0
fi

RULES_RAW=$(cat <<'OMH_RULES'
{{#each rules}}{{{this}}}
OMH_RULES_SEP
{{/each}}
OMH_RULES
)
HITS=""
ERR=$(mktemp)
while IFS= read -r RULE; do
  [[ -z "$RULE" ]] && continue
  STATUS=0
  OUT=$("$JGREP" --json -t {{threshold}} --diff --staged "$RULE" 2>"$ERR") || STATUS=$?
  case "$STATUS" in
    0)
      LINES=$(printf '%s' "$OUT" | jq -r '.[]? | "  \\(.file):\\(.start)-\\(.end) (p=\\(.p))"' 2>/dev/null || true)
      [[ -n "$LINES" ]] && HITS+="rule \\"$RULE\\":
$LINES
" ;;
    1) ;;
    *)
      _log_event "allow" "jgrep failed (exit $STATUS): $(head -c 200 "$ERR" | tr '\\n' ' ')"
      rm -f "$ERR"; exit 0 ;;
  esac
done < <(printf '%s' "$RULES_RAW" | jq -Rs -r 'rtrimstr("\\nOMH_RULES_SEP") | split("\\nOMH_RULES_SEP\\n") | map(select(. != "")) | .[]')
rm -f "$ERR"

if [[ -n "$HITS" ]]; then
  REASON="oh-my-harness: the staged diff matches a lint rule; fix these hunks before committing:
$HITS"
  _log_event "block" "$REASON"
  _emit_decision "block" "$REASON"
  exit 0
fi
exit 0`,
};
