import fs from "node:fs/promises";
import path from "node:path";
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
  "# Managed by oh-my-harness — do not edit between markers\n" +
  "# https://github.com/kyu1204/oh-my-harness\n";

const CONFIG_MARKER_START = "# >>> oh-my-harness >>>";
const CONFIG_MARKER_END = "# <<< oh-my-harness <<<";

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

const MARKER_RE = new RegExp(`${CONFIG_MARKER_START}[\\s\\S]*?${CONFIG_MARKER_END}\\n?`);
const FEATURES_HEADER_RE = /^\[features\]\s*\n?/m;
const NEXT_TABLE_RE = /^\[[^\]]+\]\s*$/m;
const CODEX_HOOKS_LINE_RE = /^[ \t]*codex_hooks\s*=\s*(?:true|false)[ \t]*\n?/m;

const INLINE_BLOCK =
  `${CONFIG_MARKER_START}\n` +
  `codex_hooks = true\n` +
  `${CONFIG_MARKER_END}`;

const STANDALONE_BLOCK =
  `${CONFIG_MARKER_START}\n` +
  `[features]\n` +
  `codex_hooks = true\n` +
  `${CONFIG_MARKER_END}\n`;

function injectIntoExistingFeatures(toml: string): string {
  const headerMatch = toml.match(FEATURES_HEADER_RE);
  if (!headerMatch || headerMatch.index === undefined) return toml;

  const headerStart = headerMatch.index;
  const headerEnd = headerStart + headerMatch[0].length;

  // Find next table header (or EOF) to bound the [features] body.
  const rest = toml.slice(headerEnd);
  const nextHeader = rest.match(NEXT_TABLE_RE);
  const bodyLen = nextHeader && nextHeader.index !== undefined ? nextHeader.index : rest.length;
  const body = rest.slice(0, bodyLen);
  const after = rest.slice(bodyLen);

  let newBody: string;
  if (CODEX_HOOKS_LINE_RE.test(body)) {
    // User already declared codex_hooks (with or without trailing keys).
    // Replace that single line with our marker block to avoid duplicate keys.
    newBody = body.replace(CODEX_HOOKS_LINE_RE, `${INLINE_BLOCK}\n`);
  } else {
    newBody = `${INLINE_BLOCK}\n${body}`;
  }

  return toml.slice(0, headerStart) + headerMatch[0] + newBody + after;
}

export function buildCodexConfigToml(existing: string): string {
  // Step 1: strip any prior managed marker block so we can re-place it
  // correctly without leaving stale duplicates behind.
  const stripped = existing.replace(MARKER_RE, "").replace(/\n{3,}/g, "\n\n");

  // Step 2: empty input → emit a standalone block with our own [features].
  if (!stripped.trim()) {
    return CODEX_CONFIG_HEADER + STANDALONE_BLOCK;
  }

  // Step 3: user already declared [features] elsewhere in the file. We must
  // NOT add a second [features] header (TOML v1.0 forbids redefining tables)
  // and we must NOT introduce a duplicate codex_hooks key (also invalid).
  if (FEATURES_HEADER_RE.test(stripped)) {
    return injectIntoExistingFeatures(stripped);
  }

  // Step 4: user content but no [features] yet → append our standalone block.
  const sep = stripped.endsWith("\n") ? "" : "\n";
  return stripped + sep + STANDALONE_BLOCK;
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
