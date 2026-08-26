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
  matcher: "Edit|Write|Bash",
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

TOOL_NAME=$(echo "\$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
FILE_PATH=$(echo "\$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
COMMAND=$(echo "\$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Codex apply_patch ships the whole patch in tool_input.command and names the
# files in "*** {Add|Update|Delete} File: <path>" headers. Collect those
# paths and treat them like file_path; the Bash write heuristic must NOT run
# over patch text (it would fire on words inside the diff).
PATCH_PATHS=()
if [[ "\$TOOL_NAME" == "apply_patch" && -n "\$COMMAND" ]]; then
  while IFS= read -r _p; do
    _p="\${_p%$'\\r'}"
    [[ -n "\$_p" ]] && PATCH_PATHS+=("\$_p")
  done < <(printf '%s\\n' "\$COMMAND" | sed -nE 's/^\\*\\*\\* (Add|Update|Delete) File: (.+)$/\\2/p')
  COMMAND=""
fi
[[ -z "\$FILE_PATH" && -z "\$COMMAND" && \${#PATCH_PATHS[@]} -eq 0 ]] && exit 0

# Component-boundary matching: wrap both sides in slashes so 'ios' matches
# ios/App.swift and /repo/ios/... but never src/kiosk.ts.
_omh_path_under() {
  local file="/\$1/" prefix="\${2%/}"
  [[ "\$file" == *"/\$prefix/"* ]]
}

# Bash coverage: a shell command that mentions a protected path AND carries a
# write indicator is blocked. Reads (cat/grep of a work order) pass.
# ponytail: substring heuristic — a command writing elsewhere while merely
# mentioning a protected path is over-blocked; tighten to arg-level parsing if
# that ever bites. This guards a drifting loop, not a malicious one — evasion
# via split cd chains, variable indirection, pushd, or symlinks is explicitly
# out of scope: winning that arms race needs a filesystem sandbox, not a hook.
_omh_bash_writes_to() {
  local cmd="\$1" target="\${2%/}"
  [[ -z "\$cmd" || -z "\$target" ]] && return 1
  [[ "\$cmd" == *"\$target"* ]] || return 1
  # The path is interpolated into an ERE below: escape its metacharacters so
  # "docs/[orders" cannot break the pattern (grep error = silent bypass) and
  # "docs/o+rders" is compared literally.
  target=$(printf '%s' "\$target" | sed -e 's/[][\\.*^$(){}?+|]/\\\\&/g')
  local WRITE_OPS='(tee|mv|cp|rm|touch|truncate|sed[[:space:]]+-i[^[:space:]]*)'
  # write op targeting the protected path directly ...
  echo "\$cmd" | grep -qE '(>|>>)[[:space:]]*[^|&;]*'"\$target"'|(^|[^[:alnum:]_])'"\$WRITE_OPS"'[[:space:]][^|&;]*'"\$target" && return 0
  # ... or a cd into it followed by any write op (relative paths escape the
  # direct pattern once the cwd is inside the protected directory)
  echo "\$cmd" | grep -qE '(^|[^[:alnum:]_])cd[[:space:]][^|&;]*'"\$target" \\
    && echo "\$cmd" | grep -qE '>|(^|[^[:alnum:]_])'"\$WRITE_OPS"'[[:space:]]' 
}

# Any path a tool call names: the direct file_path plus apply_patch headers.
_omh_any_path_under() {
  local prefix="\$1" f
  [[ -n "\$FILE_PATH" ]] && _omh_path_under "\$FILE_PATH" "\$prefix" && return 0
  for f in "\${PATCH_PATHS[@]+"\${PATCH_PATHS[@]}"}"; do
    _omh_path_under "\$f" "\$prefix" && return 0
  done
  return 1
}

WORK_ORDERS='{{{workOrders}}}'
if _omh_any_path_under "\$WORK_ORDERS" || _omh_bash_writes_to "\$COMMAND" "\$WORK_ORDERS"; then
  REASON="oh-my-harness: loop-guard — the loop must not write its own work orders. Mark the task 'BLOCKED: no work order' and move on; the architect writes work orders."
  _log_event "block" "\$REASON"
  _emit_decision "block" "\$REASON"
  exit 0
fi

ARCHITECT_ONLY=({{#each architectOnly}}"{{{this}}}" {{/each}})
for prefix in "\${ARCHITECT_ONLY[@]+"\${ARCHITECT_ONLY[@]}"}"; do
  [[ -z "\$prefix" ]] && continue
  if _omh_any_path_under "\$prefix" || _omh_bash_writes_to "\$COMMAND" "\$prefix"; then
    REASON="oh-my-harness: loop-guard — \$prefix is architect-only. Mark the task 'BLOCKED: architect-only path' and move on."
    _log_event "block" "\$REASON"
    _emit_decision "block" "\$REASON"
    exit 0
  fi
done

exit 0`,
  tags: ["loop", "autonomous", "quality", "guardrail"],
};
