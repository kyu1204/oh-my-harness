import { promises as fs } from "node:fs";
import path from "node:path";
import { OMH_HOOKS_DIR } from "../utils/paths.js";

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error;
}

function isStrictDescendant(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function stripWrappingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === "'" && last === "'") || (first === "\"" && last === "\"")) {
    return value.slice(1, -1);
  }
  return value;
}

function extractCommandCandidates(command: string): string[] {
  const candidates: string[] = [];
  const quoted = /(['"])(.*?)\1/g;
  for (const match of command.matchAll(quoted)) {
    if (match[2]) candidates.push(match[2]);
  }
  for (const token of command.split(/\s+/)) {
    const stripped = stripWrappingQuotes(token.trim());
    if (stripped) candidates.push(stripped);
  }
  return Array.from(new Set(candidates));
}

async function realpathIfPresent(filePath: string): Promise<string | null> {
  try {
    return await fs.realpath(filePath);
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") return null;
    return null;
  }
}

/**
 * Return true only when a hook command points at a script owned by this project
 * under `.omh/hooks`. The check prefers realpath boundaries so a symlink inside
 * `.omh/hooks` that points outside the project is not treated as managed.
 */
export async function isOmhHookCommand(command: unknown, projectDir: string): Promise<boolean> {
  if (typeof command !== "string" || command.trim() === "") return false;

  const hooksDir = path.join(projectDir, OMH_HOOKS_DIR);
  const hooksDirReal = await realpathIfPresent(hooksDir);
  if (!hooksDirReal) return false;

  const hooksDirResolved = path.resolve(hooksDir);
  for (const candidate of extractCommandCandidates(command)) {
    const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(projectDir, candidate);
    const candidateReal = await realpathIfPresent(absolute);
    if (candidateReal) {
      if (isStrictDescendant(hooksDirReal, candidateReal)) return true;
      continue;
    }

    // Stale generated hooks may have been removed before settings/config merge.
    // Fall back to lexical containment only for paths already under this
    // project's hooks directory; real files and symlinks always use realpath.
    const resolved = path.resolve(absolute);
    if (path.isAbsolute(candidate) && isStrictDescendant(hooksDirResolved, resolved)) return true;
  }

  return false;
}
