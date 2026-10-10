import path from "node:path";

/**
 * Hook command lines, one shape per runtime (#154). None of them embed the
 * machine path, so the generated configs and scripts are safe to commit and
 * work in every checkout, worktree and CI run.
 *
 * - claude: Claude Code exports CLAUDE_PROJECT_DIR to hooks and keeps it on the
 *   project root even after `cd` or entering a worktree.
 * - codex:  Codex runs hooks in the session cwd (possibly a subdirectory) and
 *   has no project-root variable, so resolve from the git root (cwd fallback).
 * - pi:     the Pi bridge spawns with cwd = project root; a relative path is enough.
 */
export type HookRuntime = "claude" | "codex" | "pi";

const CLAUDE_ROOT = "${CLAUDE_PROJECT_DIR}";
const CODEX_ROOT = "$(git rev-parse --show-toplevel 2>/dev/null || pwd)";
const ROOT_ANCHORS = [CLAUDE_ROOT, "$CLAUDE_PROJECT_DIR", CODEX_ROOT];

export function buildHookCommand(scriptRel: string, runtime: HookRuntime): string {
  const dq = scriptRel.replace(/(["$`\\])/g, "\\$1");
  switch (runtime) {
    case "claude":
      return `bash "${CLAUDE_ROOT}/${dq}"`;
    case "codex":
      return `bash "${CODEX_ROOT}/${dq}"`;
    case "pi":
      return `bash '${scriptRel.replace(/'/g, `'\\''`)}'`;
  }
}

export interface ParsedHookCommand {
  /** Script path with any project-root anchor stripped: project-relative, or absolute (legacy). */
  script: string;
  /** True when the command pinned the script to the project root (anchor or absolute path). */
  anchored: boolean;
}

/** Parse `bash <path>` in any of the emitted shapes (or a bare/legacy path). */
export function parseHookCommand(command: string): ParsedHookCommand | null {
  const m = command.trim().match(/^bash\s+(?:'([^']*)'|"([^"]*)"|([^\s'"]+))$/);
  if (!m) return null;
  const raw = m[1] ?? m[2] ?? m[3];
  for (const root of ROOT_ANCHORS) {
    if (raw.startsWith(`${root}/`)) return { script: raw.slice(root.length + 1), anchored: true };
  }
  return { script: raw, anchored: path.isAbsolute(raw) };
}

/** Re-emit an anchored, project-relative command for another runtime; anything else passes through. */
export function rewriteHookCommand(command: string, runtime: HookRuntime): string {
  const parsed = parseHookCommand(command);
  if (!parsed?.anchored || path.isAbsolute(parsed.script)) return command;
  return buildHookCommand(parsed.script, runtime);
}

/** Absolute on-disk path of the script a hook command runs, or null when it is not a bash script. */
export function resolveHookScript(command: string, projectDir: string): string | null {
  const parsed = parseHookCommand(command);
  if (!parsed) return null;
  return path.isAbsolute(parsed.script) ? parsed.script : path.join(projectDir, parsed.script);
}
