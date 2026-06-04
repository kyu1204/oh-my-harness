import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "smol-toml";
import type { HooksOutput } from "./hooks.js";
import { isOmhHookCommand } from "../core/managed-hooks.js";

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
  "# The hooks=true entry under [features] is required for Codex hooks.\n" +
  "# The goals=true entry under [features] enables Codex /goal.\n" +
  "# Add your own tables (e.g. [mcp_servers.foo]) above or below freely.\n" +
  "# https://github.com/kyu1204/oh-my-harness\n\n";

const REQUIRED_CODEX_FEATURES: Record<string, boolean> = {
  hooks: true,
  goals: true,
};

// Feature flags Codex has deprecated. We strip these on every sync so a
// previously-generated config.toml stops emitting Codex's deprecation warning
// (`[features].codex_hooks is deprecated. Use [features].hooks instead.`).
const DEPRECATED_CODEX_FEATURES: readonly string[] = ["codex_hooks"];

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

type CodexHookEntry = { matcher?: unknown; hooks?: unknown };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function normalizeExistingCodexHooks(raw: string): Record<string, unknown[]> {
  if (!raw.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `oh-my-harness: .codex/hooks.json is invalid JSON; ` +
        `fix it before re-running sync to avoid losing user hooks. (${(err as Error).message})`,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new Error("oh-my-harness: incompatible Codex hooks schema in .codex/hooks.json.");
  }
  const hooks = parsed.hooks;
  if (hooks === undefined) return {};
  if (!isPlainObject(hooks)) {
    throw new Error("oh-my-harness: incompatible Codex hooks schema in .codex/hooks.json.");
  }

  const normalized: Record<string, unknown[]> = {};
  for (const [event, entries] of Object.entries(hooks)) {
    if (Array.isArray(entries)) {
      normalized[event] = entries;
    } else if (isPlainObject(entries)) {
      normalized[event] = [entries];
    } else {
      throw new Error(`oh-my-harness: incompatible Codex hooks schema for event ${event}.`);
    }
  }
  return normalized;
}

async function stripOmhHooksFromCodexEntries(
  entries: unknown[],
  projectDir: string,
): Promise<unknown[]> {
  const preserved: unknown[] = [];
  for (const entry of entries) {
    if (!isPlainObject(entry)) {
      throw new Error("oh-my-harness: incompatible Codex hooks entry in .codex/hooks.json.");
    }
    const hooks = (entry as CodexHookEntry).hooks;
    if (!Array.isArray(hooks)) {
      throw new Error("oh-my-harness: incompatible Codex hooks handler list in .codex/hooks.json.");
    }

    const userHooks: unknown[] = [];
    for (const hook of hooks) {
      if (
        isPlainObject(hook) &&
        typeof hook.command === "string" &&
        await isOmhHookCommand(hook.command, projectDir)
      ) {
        continue;
      }
      userHooks.push(hook);
    }

    if (userHooks.length > 0) preserved.push({ ...entry, hooks: userHooks });
  }
  return preserved;
}

export async function mergeCodexHooksFile(
  existingRaw: string,
  generated: CodexHooksFile,
  projectDir: string,
): Promise<CodexHooksFile> {
  const existing = normalizeExistingCodexHooks(existingRaw);
  const merged: CodexHooksFile = { hooks: {} };

  for (const [event, entries] of Object.entries(existing)) {
    const preserved = await stripOmhHooksFromCodexEntries(entries, projectDir);
    if (preserved.length > 0) {
      merged.hooks[event] = preserved as CodexHooksFile["hooks"][string];
    }
  }

  for (const [event, entries] of Object.entries(generated.hooks)) {
    if (!merged.hooks[event]) merged.hooks[event] = [];
    merged.hooks[event].push(...entries);
  }

  return merged;
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
      // Refuse to silently overwrite: a parse failure here means the user
      // has hand-edited config.toml and introduced a syntax error. If we
      // regenerate from {} we'd discard their MCP server entries and any
      // other user tables. Surface the error and let the user fix it.
      throw new Error(
        `oh-my-harness: .codex/config.toml is invalid TOML; ` +
          `fix the syntax error before re-running sync to avoid losing user content. ` +
          `(${(err as Error).message})`,
      );
    }
  }

  // `features` may be missing, a scalar (e.g. `features = true`), or an
  // array — only treat it as an existing table when it actually is one.
  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);
  const features = isPlainObject(data.features) ? data.features : {};
  // Strip deprecated flags first so a config generated by an older
  // oh-my-harness (which wrote codex_hooks) migrates cleanly to the new key.
  for (const deprecated of DEPRECATED_CODEX_FEATURES) {
    delete features[deprecated];
  }
  for (const [feature, enabled] of Object.entries(REQUIRED_CODEX_FEATURES)) {
    features[feature] = enabled;
  }
  data.features = features;

  return CODEX_CONFIG_HEADER + stringify(data) + "\n";
}

/**
 * Compute the .codex/hooks.json and .codex/config.toml contents (merging into
 * the existing TOML) without writing.
 */
export async function computeCodexConfig(
  options: GenerateCodexConfigOptions,
): Promise<{ path: string; content: string }[]> {
  const { projectDir, hooksOutput } = options;
  const codexDir = path.join(projectDir, ".codex");
  const hooksPath = path.join(codexDir, "hooks.json");
  const tomlPath = path.join(codexDir, "config.toml");

  const { codexHooks } = buildCodexHooks(hooksOutput);

  let existingToml = "";
  let existingHooks = "";
  try {
    existingToml = await fs.readFile(tomlPath, "utf8");
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== "ENOENT") throw error;
  }
  try {
    existingHooks = await fs.readFile(hooksPath, "utf8");
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== "ENOENT") throw error;
  }
  const newToml = buildCodexConfigToml(existingToml);
  const newHooks = await mergeCodexHooksFile(existingHooks, codexHooks, projectDir);

  return [
    { path: hooksPath, content: JSON.stringify(newHooks, null, 2) + "\n" },
    { path: tomlPath, content: newToml },
  ];
}

export async function generateCodexConfig(options: GenerateCodexConfigOptions): Promise<string[]> {
  const planned = await computeCodexConfig(options);
  await fs.mkdir(path.join(options.projectDir, ".codex"), { recursive: true });
  for (const f of planned) {
    await fs.writeFile(f.path, f.content, "utf8");
  }
  return planned.map((f) => f.path);
}
