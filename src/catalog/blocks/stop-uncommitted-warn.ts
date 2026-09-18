import type { BuildingBlock } from "../types.js";

// Stop-event notice (#117): when the turn ends with uncommitted changes, say
// so as a system message. Never blocks; the point is that the human sees what
// was left behind instead of discovering it later.
export const stopUncommittedWarn: BuildingBlock = {
  id: "stop-uncommitted-warn",
  name: "Stop Uncommitted Warning",
  description: "When the agent ends its turn with uncommitted changes, lists them as a system message (never blocks)",
  category: "git",
  event: "Stop",
  canBlock: false,
  params: [],
  tags: ["stop", "git", "notice"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
if ! CHANGES=$(git status --porcelain 2>&1); then
  MSG="oh-my-harness: could not read git status, so uncommitted changes may be unreported: $(printf '%s' "$CHANGES" | head -n 3)"
  _log_event "allow" "$MSG"
  jq -cn --arg m "$MSG" '{systemMessage:$m}'
  exit 0
fi
[[ -z "$CHANGES" ]] && exit 0
N=$(printf '%s\\n' "$CHANGES" | wc -l | tr -d ' ')
MSG="oh-my-harness: $N uncommitted change(s) left behind:
$(printf '%s\\n' "$CHANGES" | head -n 20)"
_log_event "allow" "$MSG"
jq -cn --arg m "$MSG" '{systemMessage:$m}'
exit 0`,
};
