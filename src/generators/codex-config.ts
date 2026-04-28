import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "smol-toml";
import type { HooksOutput } from "./hooks.js";

export interface GenerateCodexConfigOptions {
  projectDir: string;
  hooksOutput: HooksOutput;
}

const CODEX_SUPPORTED_EVENTS = new Set([
  "SessionStart",
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "PermissionRequest",
  "Stop",
]);

const CODEX_CONFIG_HEADER =
  "# Managed by oh-my-harness.\n" +
  "# The codex_hooks=true entry under [features] is required.\n" +
  "# Add your own tables (e.g. [mcp_servers.foo]) above or below freely.\n" +
  "# https://github.com/kyu1204/oh-my-harness\n\n";

function normalizeMatcher(matcher: string): string {
  if (!matcher) return matcher;
  // Codex: apply_patch is the canonical edit tool; Claude uses Edit/Write aliases.
  // Keep both so the same regex matcher works in either runtime.
  if (/^Edit(\|Write)?$|^Write(\|Edit)?$/.test(matcher)) {
    return `${matcher}|apply_patch`;
  }
  return matcher;
}

export interface CodexHooksFile {
  hooks: Record<string, Array<{ matcher: string; hooks: Array<{ type: "command"; command: string }> }>>;
}

export function buildCodexHooks(hooksOutput: HooksOutput): {
  codexHooks: CodexHooksFile;
  skipped: string[];
} {
  const codexHooks: CodexHooksFile = { hooks: {} };
  const skipped: string[] = [];

  for (const [event, entries] of Object.entries(hooksOutput.hooksConfig)) {
    if (!CODEX_SUPPORTED_EVENTS.has(event)) {
      skipped.push(event);
      continue;
    }
    codexHooks.hooks[event] = entries.map((entry) => ({
      matcher: normalizeMatcher(entry.matcher),
      hooks: entry.hooks.map((h) => ({ type: h.type, command: h.command })),
    }));
  }

  return { codexHooks, skipped };
}

/**
 * Build the .codex/config.toml content using a real TOML parser.
 *
 * Why a parser, not regex: the prior regex-based approach kept producing
 * spec-edge bugs (duplicate [features] headers, duplicate codex_hooks keys,
 * unhandled [[array-tables]], inline comments, multi-line strings). A
 * spec-compliant parse → mutate → stringify round-trip handles all those
 * cases for free.
 *
 * Trade-off: TOML round-trip does NOT preserve comments. Users who hand-edit
 * .codex/config.toml will lose any comments on the next sync. The header
 * banner above documents this and points users to keep their notes elsewhere
 * (or in the project repo). MCP server entries, custom tables, and key
 * values are all preserved.
 */
export function buildCodexConfigToml(existing: string): string {
  let data: Record<string, unknown> = {};
  if (existing.trim()) {
    try {
      data = parse(existing) as Record<string, unknown>;
    } catch (err) {
      // Malformed user TOML: warn so the user knows we're regenerating, then
      // start fresh. (generateCodexConfig still skips the write when the new
      // content equals `existing`, so this only kicks in for actual edits.)
      console.warn(
        `oh-my-harness: .codex/config.toml is invalid TOML, regenerating ` +
          `from scratch — original content will be replaced. (${(err as Error).message})`,
      );
      data = {};
    }
  }

  // `features` may be missing, a scalar (e.g. `features = true`), or an
  // array — only treat it as an existing table when it actually is one.
  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);
  const features = isPlainObject(data.features) ? data.features : {};
  features.codex_hooks = true;
  data.features = features;

  return CODEX_CONFIG_HEADER + stringify(data) + "\n";
}

export async function generateCodexConfig(options: GenerateCodexConfigOptions): Promise<string[]> {
  const { projectDir, hooksOutput } = options;
  const codexDir = path.join(projectDir, ".codex");
  await fs.mkdir(codexDir, { recursive: true });

  const hooksPath = path.join(codexDir, "hooks.json");
  const tomlPath = path.join(codexDir, "config.toml");

  const { codexHooks } = buildCodexHooks(hooksOutput);
  await fs.writeFile(hooksPath, JSON.stringify(codexHooks, null, 2) + "\n", "utf8");

  let existingToml = "";
  try {
    existingToml = await fs.readFile(tomlPath, "utf8");
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== "ENOENT") throw error;
  }
  const newToml = buildCodexConfigToml(existingToml);
  if (newToml !== existingToml) {
    await fs.writeFile(tomlPath, newToml, "utf8");
  }

  return [hooksPath, tomlPath];
}
