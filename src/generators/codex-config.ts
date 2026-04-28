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

export function buildCodexConfigToml(existing: string): string {
  const managedBlock =
    `${CONFIG_MARKER_START}\n` +
    `[features]\n` +
    `codex_hooks = true\n` +
    `${CONFIG_MARKER_END}\n`;

  if (!existing) {
    return CODEX_CONFIG_HEADER + managedBlock;
  }

  const re = new RegExp(`${CONFIG_MARKER_START}[\\s\\S]*?${CONFIG_MARKER_END}\\n?`);
  if (re.test(existing)) {
    return existing.replace(re, managedBlock);
  }
  const sep = existing.endsWith("\n") ? "" : "\n";
  return existing + sep + managedBlock;
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
