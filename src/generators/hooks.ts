import { mkdir, writeFile, chmod, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { MergedConfig } from "../core/preset-types.js";

function buildLoggerSnippet(event: string, projectDir?: string): string {
  const stateDir = projectDir
    ? `${projectDir}/.claude/hooks/.state`
    : ".claude/hooks/.state";
  return `# --- oh-my-harness event logger ---
_OMH_STATE_DIR="${stateDir}"
mkdir -p "$_OMH_STATE_DIR" 2>/dev/null || true
_OMH_HOOK_NAME="$(basename "$0")"
_OMH_EVENT="${event}"
_OMH_LOGGED=0
_log_event() {
  _OMH_LOGGED=1
  local decision="\${1:-allow}" reason="\${2:-}"
  printf '{"ts":"%s","event":"%s","hook":"%s","decision":"%s","reason":"%s"}\\n' \\
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$_OMH_EVENT" "$_OMH_HOOK_NAME" "$decision" "$reason" \\
    >> "$_OMH_STATE_DIR/events.jsonl"
}
trap '[ "$_OMH_LOGGED" -eq 0 ] && _log_event "allow"' EXIT
# --- end logger ---`;
}

export function wrapWithLogger(script: string, event: string = "unknown", projectDir?: string): string {
  const snippet = buildLoggerSnippet(event, projectDir);
  if (script.includes("INPUT=$(cat)")) {
    return script.replace("INPUT=$(cat)", `INPUT=$(cat)\n\n${snippet}`);
  }
  if (script.includes("set -euo pipefail")) {
    return script.replace("set -euo pipefail", `set -euo pipefail\n\n${snippet}`);
  }
  // shebang 패턴: #!/bin/bash, #!/usr/bin/env bash, #!/bin/sh 등
  const shebangMatch = script.match(/^#!.+$/m);
  if (shebangMatch) {
    return script.replace(shebangMatch[0], `${shebangMatch[0]}\n\n${snippet}`);
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
  hooks: string[];
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error;
}

async function readPreviousHookNames(manifestPath: string): Promise<string[]> {
  try {
    const manifestRaw = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestRaw) as { hooks?: string[] };
    return manifest.hooks ?? [];
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
    hooks,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

export async function generateHooks(options: GenerateHooksOptions): Promise<HooksOutput> {
  const { projectDir, config } = options;
  const hooksDir = join(projectDir, ".claude/hooks");

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

  await mkdir(hooksDir, { recursive: true });

  // Read previous manifest to clean up stale hook files
  const manifestPath = join(hooksDir, "oh-my-harness-manifest.json");
  const previousHooks = await readPreviousHookNames(manifestPath);

  if (allHooks.length === 0) {
    // Remove all previously generated hooks
    for (const name of previousHooks) {
      await unlinkIfPresent(join(hooksDir, name));
    }
    await writeHookManifest(manifestPath, []);
    return { hooksConfig: {}, generatedFiles: [] };
  }

  const generatedFiles: string[] = [];
  const hooksConfig: Record<string, Array<{ matcher: string; hooks: HookCommand[] }>> = {};
  const usedScriptNames = new Set<string>();

  for (const hook of allHooks) {
    if (!hook.inline) {
      continue;
    }

    const safeId = hook.id.replace(/[^a-zA-Z0-9_-]/g, "") || "hook";
    let scriptName = `${safeId}.sh`;
    // Prevent collisions within the same event using numeric suffix
    if (usedScriptNames.has(scriptName)) {
      let counter = 1;
      while (usedScriptNames.has(`${safeId}-${counter}.sh`)) {
        counter++;
      }
      scriptName = `${safeId}-${counter}.sh`;
    }
    usedScriptNames.add(scriptName);

    const scriptPath = join(hooksDir, scriptName);
    const wrappedScript = wrapWithLogger(hook.inline, hook.event, projectDir);
    await writeFile(scriptPath, wrappedScript, "utf8");
    await chmod(scriptPath, 0o755);
    generatedFiles.push(scriptPath);

    const entry = {
      matcher: hook.matcher,
      hooks: [{ type: "command" as const, command: `bash "${scriptPath}"` }],
    };
    if (!hooksConfig[hook.event]) {
      hooksConfig[hook.event] = [];
    }
    hooksConfig[hook.event].push(entry);
  }

  // Remove stale hook files from previous sync that are no longer generated
  const currentNames = new Set(generatedFiles.map((f) => f.split("/").pop() as string));
  for (const name of previousHooks) {
    if (!currentNames.has(name)) {
      await unlinkIfPresent(join(hooksDir, name));
    }
  }

  await writeHookManifest(
    manifestPath,
    generatedFiles.map((f) => f.split("/").pop() as string),
  );

  return { hooksConfig, generatedFiles };
}
