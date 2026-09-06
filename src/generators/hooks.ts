import { mkdir, writeFile, chmod, readFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import type { MergedConfig } from "../core/merged-config.js";
import type { PlannedFile } from "../core/plan.js";
import { OMH_HOOKS_DIR, OMH_STATE_DIR, OMH_MANIFEST, OMH_EVENTS_FILE } from "../utils/paths.js";
import { OMH_VERSION } from "../utils/version.js";

// Wrap a path/value in bash single quotes, escaping any embedded single
// quotes. Single-quoted strings are not subject to shell expansion, so this
// is safe for paths containing $, backticks, double quotes, etc.
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Shell-token helpers shared by every generated hook (#109). Guards must not
// grep the raw command string: text inside quotes or heredocs is data, not a
// command, and a pattern like "rm -rf /" must not match "rm -rf /tmp". The
// tokenizer is a single-pass awk state machine so it runs anywhere bash does.
//   _omh_simple_commands "<cmd>"          one simple command per line, TAB-separated tokens, quotes resolved
//   _omh_cmd_matches "<cmd>" argv0 [sub]  0 when some simple command is `argv0 [opts] sub`
//   _omh_cmd_has_pattern "<cmd>" "<pat>"  0 when pat's tokens appear contiguously in some simple command
// ponytail: backticks and process substitution <(...) are treated as plain text;
// $(...) is parsed as a nested command stream. Wrapper unwrapping (sh -c, eval) is #110.
const OMH_CMD_TOKENIZER_AWK = String.raw`
{ buf = buf $0 "\n" }
END {
  n = length(buf); d = 0; q[0] = 0; tok[0] = ""; cmd[0] = ""; nhd[0] = 0
  i = 1
  while (i <= n) {
    c = substr(buf, i, 1); c2 = substr(buf, i, 2)
    if (q[d] == 1) {                       # inside single quotes
      if (c == "\047") q[d] = 0; else tok[d] = tok[d] c
      i++; continue
    }
    if (q[d] == 2) {                       # inside double quotes
      if (c == "\"") { q[d] = 0; i++; continue }
      if (c == "\\" && i < n) { tok[d] = tok[d] substr(buf, i+1, 1); i += 2; continue }
      if (c2 == "$(") { d++; q[d] = 0; tok[d] = ""; cmd[d] = ""; nhd[d] = 0; i += 2; continue }
      tok[d] = tok[d] c; i++; continue
    }
    if (c == "\047") { q[d] = 1; i++; continue }
    if (c == "\"")   { q[d] = 2; i++; continue }
    if (c == "\\") { if (substr(buf, i+1, 1) != "\n") tok[d] = tok[d] substr(buf, i+1, 1); i += 2; continue }
    if (c == "#" && tok[d] == "") { while (i <= n && substr(buf, i, 1) != "\n") i++; continue }
    if (c2 == "$(") { d++; q[d] = 0; tok[d] = ""; cmd[d] = ""; nhd[d] = 0; i += 2; continue }
    if (substr(buf, i, 3) == "<<<") { i += 3; skipnext[d] = 1; continue }   # here-string: drop operator and word
    if (c2 == "<<") {                      # heredoc: remember the delimiter, drop the operator
      i += 2; strip[d, nhd[d] + 1] = 0; if (substr(buf, i, 1) == "-") { i++; strip[d, nhd[d] + 1] = 1 }
      while (substr(buf, i, 1) == " ") i++
      delim = ""
      while (i <= n) { h = substr(buf, i, 1); if (h ~ /[ \t\n;|&)]/) break; if (h != "\047" && h != "\"") delim = delim h; i++ }
      nhd[d]++; hd[d, nhd[d]] = delim; continue
    }
    if (c == ")" && d > 0) {               # end of $( ... )
      flush(d)
      if (cmd[d] != "") print cmd[d]
      d--; tok[d] = tok[d] "$(...)"; i++; continue
    }
    if (c ~ /[ \t]/) { flush(d); i++; continue }
    if (c == "&" && tok[d] ~ />$/) { tok[d] = tok[d] "&"; i++; continue }   # 2>&1, >&2
    if (c2 == "&>") { flush(d); tok[d] = "&"; i++; continue }               # &>log, &>>log
    if (c ~ /[;|&()\n]/) {                 # command separator
      flush(d)
      if (cmd[d] != "") print cmd[d]; cmd[d] = ""; skipnext[d] = 0
      i++
      if (c == "\n" && nhd[d] > 0) {       # skip heredoc bodies that start on the next line
        for (k = 1; k <= nhd[d]; k++) {
          while (i <= n) {
            j = index(substr(buf, i), "\n"); line = (j ? substr(buf, i, j-1) : substr(buf, i))
            i = (j ? i + j : n + 1); if (strip[d, k]) sub(/^\t+/, "", line)
            if (line == hd[d, k]) break
          }
        }
        nhd[d] = 0
      }
      continue
    }
    tok[d] = tok[d] c; i++
  }
  while (d >= 0) {
    flush(d)
    if (cmd[d] != "") print cmd[d]
    d--
  }
}
# Append the pending token to the current simple command, unless it is a
# redirection (2>/dev/null, >file, <in, 2>&1, &>log) or the word a bare
# redirection operator (2>, >, <, >>) applies to. Output-redirection targets
# are emitted as their own "__omh_redirect__<TAB>target" line so guards that
# care about writes (harness-guard) can see them; argv0 matchers never match
# that pseudo-command.
function flush(d,   t) {
  if (tok[d] == "") return
  if (skipnext[d]) {
    # the word an output redirection applies to: report it as a write target
    if (skipnext[d] == 2) print "__omh_redirect__\t" tok[d]
    skipnext[d] = 0; tok[d] = ""; return
  }
  if (tok[d] ~ /^[0-9]*(>>?|<|&>>?|>&)/) {
    if (tok[d] ~ /^[0-9]*(>>?|&>>?)$/) skipnext[d] = 2        # bare "> " / "2> " / "&> ": next word is written
    else if (tok[d] ~ /^<$/) skipnext[d] = 1                   # bare "< ": next word is read
    else if (tok[d] ~ /^[0-9]*(>>?|&>>?)[^&]/) {              # attached ">file" (not the ">&2" dup form)
      t = tok[d]; sub(/^[0-9]*(>>?|&>>?)/, "", t); print "__omh_redirect__\t" t
    }
    tok[d] = ""; return
  }
  cmd[d] = cmd[d] (cmd[d] == "" ? "" : "\t") tok[d]; tok[d] = ""
}`;

// Wrapper unwrapping (#110). Runs on each TAB-separated simple command the
// tokenizer emits. Leading wrappers that only change *how* a command runs
// (env, timeout, nohup, nice, xargs, command, exec, builtin, time) are
// stripped so the real argv0 is matched (sudo/doas are kept as tokens so user
// patterns like "sudo rm" still work; _omh_cmd_matches skips them). `sh -c <string>` and `eval <words>`
// carry the real command as data, so those are printed as "S<TAB><string>"
// for the bash side to re-tokenize; everything else is "R<TAB><tokens>".
// ponytail: bounded to 4 levels; deeper nesting is left unparsed rather than
// blocked, so a pathological command cannot make every guard fire at once.
const OMH_CMD_UNWRAP_AWK = String.raw`
BEGIN { FS = "\t" }
{
  i = 1
  while (i <= NF) {
    while (i <= NF && $i ~ /^[A-Za-z_][A-Za-z0-9_]*=/) i++
    if (i > NF) break
    f = $i
    if (f == "env") {
      i++; while (i <= NF && $i ~ /^-/) { if ($i ~ /^-(u|C|S)$/) i++; i++ }; continue
    }
    if (f == "nohup" || f == "command" || f == "exec" || f == "builtin" || f == "time") {
      i++; while (i <= NF && $i ~ /^-/) i++; continue
    }
    if (f == "nice") {
      i++; while (i <= NF && $i ~ /^-/) { if ($i == "-n") i++; i++ }; continue
    }
    if (f == "timeout") {
      i++; while (i <= NF && $i ~ /^-/) { if ($i ~ /^-(s|k)$/) i++; i++ }; i++; continue
    }
    if (f == "xargs") {
      i++; while (i <= NF && $i ~ /^-/) { if ($i ~ /^-(I|n|L|P|s|d|E|a)$/) i++; i++ }; continue
    }
    if (f == "sh" || f == "bash" || f == "zsh" || f == "dash" || f == "ksh") {
      j = i + 1
      while (j <= NF && $j ~ /^-/) {
        if ($j ~ /^-[A-Za-z]*c$/) { if (j + 1 <= NF) { print "S\t" $(j + 1); next }; break }
        j++
      }
      break
    }
    if (f == "eval") {
      out = ""; for (k = i + 1; k <= NF; k++) out = out (k > i + 1 ? " " : "") $k
      print "S\t" out; next
    }
    break
  }
  if (i > NF) next
  out = ""; for (k = i; k <= NF; k++) out = out (k > i ? "\t" : "") $k
  print "R\t" out
}`;

const OMH_CMD_HELPERS = `_omh_tokenize() {
  printf '%s\\n' "\${1:-}" | awk '${OMH_CMD_TOKENIZER_AWK}'
}
_omh_simple_commands() {
  local depth="\${2:-0}" kind rest
  _omh_tokenize "\${1:-}" | while IFS= read -r line; do
    printf '%s\\n' "$line" | awk '${OMH_CMD_UNWRAP_AWK}' | while IFS=$'\\t' read -r kind rest; do
      if [ "$kind" = "S" ] && [ "$depth" -lt 4 ]; then
        _omh_simple_commands "$rest" $((depth + 1))
      elif [ "$kind" = "S" ]; then
        printf '%s\\n' "$line"
      else
        printf '%s\\n' "$rest"
      fi
    done
  done
}
_omh_cmd_matches() {
  local a0="\${2:-}" sc="\${3:-}"
  _omh_simple_commands "\${1:-}" | awk -F '\t' -v a0="$a0" -v sc="$sc" '
    { i = 1
      while (i <= NF && $i ~ /^[A-Za-z_][A-Za-z0-9_]*=/) i++
      if (i <= NF && ($i == "sudo" || $i == "doas")) {
        i++; while (i <= NF && $i ~ /^-/) { if ($i ~ /^-(u|g|C|D|h|p|r|t|T|U)$/) i++; i++ }
      }
      if (i > NF || $i != a0) next
      if (sc == "") { found = 1; next }
      i++
      while (i <= NF && $i ~ /^-/) { if ($i == "-c" || $i == "-C") i++; i++ }
      if (i <= NF && $i == sc) { found = 1; next } }
    END { exit found ? 0 : 1 }'
}
_omh_cmd_has_pattern() {
  _omh_simple_commands "\${1:-}" | awk -F '\t' -v pat="\${2:-}" '
    BEGIN { n = split(pat, p, " ") }
    { for (s = 1; s + n - 1 <= NF; s++) {
        ok = 1
        for (k = 1; k <= n; k++) if ($(s + k - 1) != p[k]) { ok = 0; break }
        if (ok) { found = 1; next } } }
    END { exit found ? 0 : 1 }'
}`;

function buildLoggerSnippet(event: string, projectDir?: string, mode: "block" | "ask" = "block"): string {
  const stateDir = projectDir
    ? `${projectDir}/${OMH_STATE_DIR}`
    : OMH_STATE_DIR;
  return `# --- oh-my-harness event logger ---
_OMH_STATE_DIR=${shellSingleQuote(stateDir)}
mkdir -p "$_OMH_STATE_DIR" 2>/dev/null || true
_OMH_HOOK_NAME="$(basename "$0")"
_OMH_EVENT="${event}"
_OMH_DECISION_MODE="${mode}"
_OMH_LOGGED=0
_log_event() {
  # Build the JSONL record entirely through jq so every string field is
  # JSON-escaped (quotes, backslashes, newlines, unicode). The previous
  # printf+%s approach corrupted the line whenever reason or any other
  # field contained these characters, and event-logger.ts silently drops
  # unparseable lines, causing event loss.
  _OMH_LOGGED=1
  local decision="\${1:-allow}" reason="\${2:-}" meta="\${3:-}"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # Meta must be a serialized JSON value (object/array/scalar); fall back
  # to no-meta when invalid so a buggy caller can't drop the event entirely.
  if [ -n "$meta" ] && ! echo "$meta" | jq -e . >/dev/null 2>&1; then
    meta=""
  fi
  if [ -n "$meta" ]; then
    jq -cn \\
      --arg ts "$ts" --arg event "$_OMH_EVENT" --arg hook "$_OMH_HOOK_NAME" \\
      --arg decision "$decision" --arg reason "$reason" --argjson meta "$meta" \\
      '{ts:$ts,event:$event,hook:$hook,decision:$decision,reason:$reason,meta:$meta}' \\
      >> "$_OMH_STATE_DIR/${OMH_EVENTS_FILE}"
  else
    jq -cn \\
      --arg ts "$ts" --arg event "$_OMH_EVENT" --arg hook "$_OMH_HOOK_NAME" \\
      --arg decision "$decision" --arg reason "$reason" \\
      '{ts:$ts,event:$event,hook:$hook,decision:$decision,reason:$reason}' \\
      >> "$_OMH_STATE_DIR/${OMH_EVENTS_FILE}"
  fi
}

# Emit a Claude/Codex hook decision JSON to stdout with all fields safely
# escaped. Catalog blocks should call this rather than handcrafting JSON
# via echo "{...}" — a file name or pattern containing a quote, backslash,
# or newline would otherwise produce invalid JSON that the runtime cannot
# parse as a block decision.
#
# In ask mode the same hook escalates to the user instead of hard-blocking,
# but only on runtimes that understand a permissionDecision:"ask" response.
# Claude's PreToolUse payload carries a transcript_path field; Codex's does
# not. A runtime we cannot positively identify as Claude falls through to a
# hard block, so a guardrail (e.g. TDD) is never silently downgraded to allow.
# The two requirements (Claude=ask, Codex=block) cannot coexist in one JSON —
# a legacy {decision:"block"} overrides permissionDecision:"ask" on Claude —
# so we branch on the caller instead of emitting a combined object.
_emit_decision() {
  local decision="\${1:-block}" reason="\${2:-}"
  if [ "\${_OMH_DECISION_MODE:-block}" = "ask" ] && [ "$decision" = "block" ]; then
    if printf '%s' "\${INPUT:-}" | jq -e 'has("transcript_path")' >/dev/null 2>&1; then
      jq -cn --arg reason "$reason" --arg event "$_OMH_EVENT" \\
        '{hookSpecificOutput:{hookEventName:$event,permissionDecision:"ask",permissionDecisionReason:$reason}}'
      return 0
    fi
  fi
  jq -cn --arg decision "$decision" --arg reason "$reason" \\
    '{decision:$decision,reason:$reason}'
}
${OMH_CMD_HELPERS}
trap '_OMH_EXIT_CODE=$?; if [ "$_OMH_LOGGED" -eq 0 ]; then if [ "$_OMH_EXIT_CODE" -ne 0 ]; then _log_event "error" "hook exited with code $_OMH_EXIT_CODE"; else _log_event "allow"; fi; fi' EXIT
# --- end logger ---`;
}

export function wrapWithLogger(
  script: string,
  event: string = "unknown",
  projectDir?: string,
  mode: "block" | "ask" = "block",
): string {
  const snippet = buildLoggerSnippet(event, projectDir, mode);
  if (script.includes("INPUT=$(cat)")) {
    return script.replace("INPUT=$(cat)", () => `INPUT=$(cat)\n\n${snippet}`);
  }
  if (script.includes("set -euo pipefail")) {
    return script.replace("set -euo pipefail", () => `set -euo pipefail\n\n${snippet}`);
  }
  // shebang 패턴: #!/bin/bash, #!/usr/bin/env bash, #!/bin/sh 등
  const shebangMatch = script.match(/^#!.+$/m);
  if (shebangMatch) {
    return script.replace(shebangMatch[0], () => `${shebangMatch[0]}\n\n${snippet}`);
  }
  return `${snippet}\n${script}`;
}

export interface GenerateHooksOptions {
  projectDir: string;
  config: MergedConfig;
}

export interface HookCommand {
  type: "command";
  command: string;
}

export interface HooksOutput {
  hooksConfig: Record<string, Array<{ matcher: string; hooks: HookCommand[] }>>;
  generatedFiles: string[];
}

interface HookManifest {
  generatedAt: string;
  omhVersion: string;
  hooks: string[];
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error;
}

async function readPreviousHookNames(manifestPath: string): Promise<string[]> {
  try {
    const manifestRaw = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestRaw) as { hooks?: unknown };
    if (!Array.isArray(manifest.hooks)) return [];
    // The manifest is on-disk input — a malicious or hand-edited entry like
    // "../../etc/hosts" would otherwise become an unlink target. Allow only
    // bare basenames to defend against path traversal during cleanup.
    return manifest.hooks.filter(
      (name): name is string =>
        typeof name === "string" && name.length > 0 && basename(name) === name,
    );
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function unlinkIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (err) {
    if (!isErrnoException(err) || err.code !== "ENOENT") {
      throw err;
    }
  }
}

async function writeHookManifest(manifestPath: string, hooks: string[]): Promise<void> {
  const manifest: HookManifest = {
    generatedAt: new Date().toISOString(),
    omhVersion: OMH_VERSION,
    hooks,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

export interface HooksPlan {
  /** Hook script files (each chmod 0o755). */
  files: PlannedFile[];
  hooksConfig: Record<string, Array<{ matcher: string; hooks: HookCommand[] }>>;
  generatedFiles: string[];
  /** Absolute paths of stale hook scripts that a sync would remove. */
  wouldDelete: string[];
  manifestPath: string;
  /** Hook basenames to record in the manifest. */
  manifestNames: string[];
}

/**
 * Compute hook scripts, settings hooksConfig, and stale-file cleanup WITHOUT
 * touching disk (other than reading the previous manifest). Shared by the
 * write path (generateHooks) and the plan/drift path.
 */
export async function computeHooks(options: GenerateHooksOptions): Promise<HooksPlan> {
  const { projectDir, config } = options;
  const hooksDir = join(projectDir, OMH_HOOKS_DIR);
  const manifestPath = join(projectDir, OMH_MANIFEST);

  const eventMap: Array<[string, typeof config.hooks.preToolUse]> = [
    ["PreToolUse", config.hooks.preToolUse],
    ["PostToolUse", config.hooks.postToolUse],
    ["SessionStart", config.hooks.sessionStart ?? []],
    ["Notification", config.hooks.notification ?? []],
    ["ConfigChange", config.hooks.configChange ?? []],
    ["WorktreeCreate", config.hooks.worktreeCreate ?? []],
  ];

  const allHooks = eventMap.flatMap(([event, hooks]) =>
    hooks.map((h) => ({ ...h, event })),
  );

  // Read previous manifest to identify stale hook files to clean up.
  const previousHooks = await readPreviousHookNames(manifestPath);

  if (allHooks.length === 0) {
    return {
      files: [],
      hooksConfig: {},
      generatedFiles: [],
      wouldDelete: previousHooks.map((name) => join(hooksDir, name)),
      manifestPath,
      manifestNames: [],
    };
  }

  const usedScriptNames = new Set<string>();
  const planned: Array<{ event: string; matcher: string; scriptPath: string; wrappedScript: string }> = [];

  for (const hook of allHooks) {
    if (!hook.inline) continue;

    const safeId = hook.id.replace(/[^a-zA-Z0-9_-]/g, "") || "hook";
    let scriptName = `${safeId}.sh`;
    if (usedScriptNames.has(scriptName)) {
      let counter = 1;
      while (usedScriptNames.has(`${safeId}-${counter}.sh`)) counter++;
      scriptName = `${safeId}-${counter}.sh`;
    }
    usedScriptNames.add(scriptName);

    planned.push({
      event: hook.event,
      matcher: hook.matcher,
      scriptPath: join(hooksDir, scriptName),
      wrappedScript: wrapWithLogger(hook.inline, hook.event, projectDir, hook.mode ?? "block"),
    });
  }

  const generatedFiles = planned.map((p) => p.scriptPath);
  const hooksConfig: Record<string, Array<{ matcher: string; hooks: HookCommand[] }>> = {};
  for (const p of planned) {
    if (!hooksConfig[p.event]) hooksConfig[p.event] = [];
    hooksConfig[p.event].push({
      matcher: p.matcher,
      hooks: [{ type: "command", command: `bash ${shellSingleQuote(p.scriptPath)}` }],
    });
  }

  const currentNames = new Set(generatedFiles.map((f) => basename(f)));
  const wouldDelete = previousHooks
    .filter((name) => !currentNames.has(name))
    .map((name) => join(hooksDir, name));

  return {
    files: planned.map((p) => ({ path: p.scriptPath, content: p.wrappedScript, chmod: 0o755 })),
    hooksConfig,
    generatedFiles,
    wouldDelete,
    manifestPath,
    manifestNames: generatedFiles.map((f) => basename(f)),
  };
}

export async function generateHooks(options: GenerateHooksOptions): Promise<HooksOutput> {
  const { projectDir } = options;
  const hooksDir = join(projectDir, OMH_HOOKS_DIR);
  const plan = await computeHooks(options);

  await mkdir(hooksDir, { recursive: true });
  await mkdir(join(projectDir, OMH_STATE_DIR), { recursive: true });

  // Independent IO across hooks — parallelize.
  await Promise.all(
    plan.files.map(async (f) => {
      await writeFile(f.path, f.content, "utf8");
      if (f.chmod !== undefined) await chmod(f.path, f.chmod);
    }),
  );

  // Remove stale hook files from a previous sync that are no longer generated.
  for (const stale of plan.wouldDelete) {
    await unlinkIfPresent(stale);
  }

  await writeHookManifest(plan.manifestPath, plan.manifestNames);

  return { hooksConfig: plan.hooksConfig, generatedFiles: plan.generatedFiles };
}
