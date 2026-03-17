import { mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import type { MergedConfig } from "../core/preset-types.js";

const LOGGER_SNIPPET = `# --- oh-my-harness event logger ---
_OMH_STATE_DIR=".claude/hooks/.state"
mkdir -p "$_OMH_STATE_DIR" 2>/dev/null || true
_OMH_HOOK_NAME="$(basename "$0")"
_log_event() {
  local decision="\${1:-allow}" reason="\${2:-}"
  printf '{"ts":"%s","hook":"%s","decision":"%s","reason":"%s"}\\n' \\
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$_OMH_HOOK_NAME" "$decision" "$reason" \\
    >> "$_OMH_STATE_DIR/events.jsonl"
}
trap '_log_event "allow"' EXIT
# --- end logger ---`;

export function wrapWithLogger(script: string): string {
  if (script.includes("INPUT=$(cat)")) {
    return script.replace("INPUT=$(cat)", `INPUT=$(cat)\n\n${LOGGER_SNIPPET}`);
  }
  if (script.includes("set -euo pipefail")) {
    return script.replace("set -euo pipefail", `set -euo pipefail\n\n${LOGGER_SNIPPET}`);
  }
  return script.replace("#!/bin/bash", `#!/bin/bash\n\n${LOGGER_SNIPPET}`);
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

export async function generateHooks(options: GenerateHooksOptions): Promise<HooksOutput> {
  const { projectDir, config } = options;
  const hooksDir = join(projectDir, ".claude/hooks");

  const allHooks = [
    ...config.hooks.preToolUse.map((h) => ({ ...h, event: "PreToolUse" as const })),
    ...config.hooks.postToolUse.map((h) => ({ ...h, event: "PostToolUse" as const })),
  ];

  if (allHooks.length === 0) {
    return { hooksConfig: {}, generatedFiles: [] };
  }

  await mkdir(hooksDir, { recursive: true });

  const generatedFiles: string[] = [];
  const hooksConfig: Record<string, Array<{ matcher: string; hooks: HookCommand[] }>> = {};

  for (const hook of allHooks) {
    if (!hook.inline) {
      continue;
    }

    const safeId = hook.id.replace(/[^a-zA-Z0-9_-]/g, "");
    const scriptName = `${safeId}.sh`;
    const scriptPath = join(hooksDir, scriptName);
    const wrappedScript = wrapWithLogger(hook.inline);
    await writeFile(scriptPath, wrappedScript, "utf8");
    await chmod(scriptPath, 0o755);
    generatedFiles.push(scriptPath);

    const entry = {
      matcher: hook.matcher,
      hooks: [{ type: "command" as const, command: `bash .claude/hooks/${safeId}.sh` }],
    };
    if (!hooksConfig[hook.event]) {
      hooksConfig[hook.event] = [];
    }
    hooksConfig[hook.event].push(entry);
  }

  // Write manifest
  const manifest = {
    generatedAt: new Date().toISOString(),
    hooks: generatedFiles.map((f) => f.split("/").pop() as string),
  };
  const manifestPath = join(hooksDir, "oh-my-harness-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return { hooksConfig, generatedFiles };
}
