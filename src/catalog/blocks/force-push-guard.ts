import type { BuildingBlock } from "../types.js";

// #99: a force push to a shared branch rewrites history for everyone. Block
// `git push` when the destination is a protected branch and the push is
// forced: --force / -f / a "+refspec". The destination
// is the refspec's target (`origin main`, `origin HEAD:main`,
// `origin feat:refs/heads/main`, `origin +main`), every refspec is checked;
// with no refspec it is git's own push target (@{push}, so push.default=upstream
// is honoured), falling back to the current branch, and if even that cannot be
// determined the push is blocked rather than guessed. --force-with-lease is allowed by default (it refuses to
// clobber unseen commits); set allowLease: false to block it too.
export const forcePushGuard: BuildingBlock = {
  id: "force-push-guard",
  name: "Force Push Guard",
  description: "Blocks git push --force / -f / +refspec to protected branches",
  category: "git",
  event: "PreToolUse",
  matcher: "Bash",
  canBlock: true,
  params: [
    {
      name: "protected",
      type: "string[]",
      description: "Branches that must never be force-pushed",
      default: ["main", "master"],
      required: false,
    },
    {
      name: "allowLease",
      type: "boolean",
      description: "Allow --force-with-lease (safe force) to protected branches",
      default: true,
      required: false,
    },
  ],
  tags: ["git", "push", "guard", "force"],
  explain: {
    allowOnce: "push to a feature branch and open a pull request; use --force-with-lease if you really need to rewrite your own branch",
    change: "harness.yaml > hooks > force-push-guard > params.protected / allowLease, or remove it, then omh sync",
  },
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -z "$COMMAND" ]] && exit 0
_omh_cmd_matches "$COMMAND" git push || exit 0

PROTECTED=({{#each protected}}"{{{this}}}" {{/each}})
CURRENT=$(git branch --show-current 2>/dev/null || echo "")
# With no refspec git pushes to the configured target, which under
# push.default=upstream can be a different branch than HEAD (feature -> main).
PUSH_TARGET=$(git rev-parse --abbrev-ref --symbolic-full-name '@{push}' 2>/dev/null || echo "")
PUSH_TARGET="\${PUSH_TARGET#*/}"
[[ -z "$PUSH_TARGET" ]] && PUSH_TARGET="$CURRENT"

HIT=$(_omh_simple_commands "$COMMAND" | awk -F '\\t' \\
  -v protected="$(IFS='|'; printf '%s' "\${PROTECTED[*]}")" -v current="$PUSH_TARGET" -v allow_lease="{{allowLease}}" '
  BEGIN { np = split(protected, P, "|"); for (k = 1; k <= np; k++) isp[P[k]] = 1 }
  found != "" { next }
  {
    i = 1
    while (i <= NF && $i ~ /^[A-Za-z_][A-Za-z0-9_]*=/) i++
    if (i <= NF && ($i == "sudo" || $i == "doas")) { i++; while (i <= NF && $i ~ /^-/) i++ }
    if (i > NF || $i != "git") next
    j = i + 1
    while (j <= NF && $j ~ /^-/) { if ($j == "-c" || $j == "-C") j++; j++ }
    if (j > NF || $j != "push") next
    force = 0; lease = 0; remote = ""; nref = 0; plus = 0
    for (k = j + 1; k <= NF; k++) {
      t = $k
      if (t == "--") { for (m = k + 1; m <= NF; m++) { if (remote == "") remote = $m; else refs[++nref] = $m }; break }
      if (t == "--force" || t == "-f" || t ~ /^-[A-Za-z]*f[A-Za-z]*$/) { force = 1; continue }
      if (t == "--force-if-includes") continue   # only modifies --force-with-lease; not a force on its own
      if (t ~ /^--force-with-lease/) { lease = 1; continue }
      if (t ~ /^--repo=/) { remote = substr(t, 8); continue }
      if (t == "--repo" || t == "-o" || t == "--push-option" || t == "--receive-pack" || t == "--exec") { k++; continue }
      if (t ~ /^-/) continue
      if (remote == "") remote = t; else refs[++nref] = t
    }
    # git pushes every refspec given; any protected destination is enough to block
    if (nref == 0) refs[++nref] = ""
    for (r = 1; r <= nref; r++) {
      dst = refs[r]; plus = 0
      if (substr(dst, 1, 1) == "+") { plus = 1; dst = substr(dst, 2) }   # "+refspec" forces without --force
      if (index(dst, ":") > 0) dst = substr(dst, index(dst, ":") + 1)
      sub(/^refs\\/heads\\//, "", dst)
      if (!force && !plus && !(lease && allow_lease == "false")) continue
      if (dst == "HEAD" || dst == "") dst = current
      if (dst == "") { found = "force push with an undeterminable target branch"; break }
      if (isp[dst]) { found = "force push to " dst; break }
    }
  }
  END { if (found != "") print found }')

if [[ -n "$HIT" ]]; then
  REASON="oh-my-harness: $HIT is blocked: rewriting a protected branch's history is not allowed. Push to a feature branch and open a PR."
  _log_event "block" "$REASON"
  _emit_decision "block" "$REASON"
  exit 0
fi
exit 0`,
};
