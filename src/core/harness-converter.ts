import type { HarnessConfig } from "./harness-schema.js";
import type { MergedConfig, ClaudeMdSection, HookDefinition, Variables } from "./preset-types.js";

export function harnessToMergedConfig(harness: HarnessConfig): MergedConfig {
  // Build variables from first stack
  const variables: Variables = {};
  if (harness.project.stacks.length > 0) {
    const primary = harness.project.stacks[0];
    variables.framework = primary.framework;
    variables.language = primary.language;
    if (primary.packageManager) variables.packageManager = primary.packageManager;
    if (primary.testRunner) variables.testRunner = primary.testRunner;
    if (primary.linter) variables.linter = primary.linter;
  }

  // Convert rules to claudeMd sections
  const claudeMdSections: ClaudeMdSection[] = harness.rules
    .map((rule) => ({
      id: rule.id,
      title: rule.title,
      content: rule.content,
      priority: rule.priority,
    }))
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));

  // Build hooks
  const preToolUse: HookDefinition[] = [];
  const postToolUse: HookDefinition[] = [];

  // preCommit hook
  if (harness.enforcement.preCommit.length > 0) {
    const commands = harness.enforcement.preCommit
      .map((cmd) => {
        const safeCmdJson = cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        return `    echo "oh-my-harness: Running ${cmd} before commit..." >&2\n    if ! ${cmd} >&2 2>&1; then\n      echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: ${safeCmdJson} failed, commit blocked\\"}"\n      exit 0\n    fi`;
      })
      .join("\n");

    preToolUse.push({
      id: "harness-pre-commit",
      matcher: "Bash",
      description: "Runs configured checks before git commit",
      inline: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
if echo "$COMMAND" | grep -qE "git commit"; then
${commands}
fi
exit 0
`,
    });
  }

  // file-guard hook from blockedPaths
  if (harness.enforcement.blockedPaths.length > 0) {
    const patterns = harness.enforcement.blockedPaths
      .map((p) => `"${p}"`)
      .join(" ");

    preToolUse.push({
      id: "harness-file-guard",
      matcher: "Edit|Write",
      description: "Prevents writing to blocked paths",
      inline: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
[[ -z "$FILE_PATH" ]] && exit 0
BLOCKED=(${patterns})
for pattern in "\${BLOCKED[@]}"; do
  if [[ "$pattern" == */ ]]; then
    if [[ "$FILE_PATH" == *"/$pattern"* ]] || [[ "$FILE_PATH" == "$pattern"* ]]; then
      echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: protected path $pattern\\"}"
      exit 0
    fi
  elif [[ "$pattern" == \\** ]]; then
    suffix="\${pattern#\\*}"
    if [[ "$FILE_PATH" == *"\$suffix" ]]; then
      echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: protected path $pattern\\"}"
      exit 0
    fi
  fi
done
exit 0
`,
    });
  }

  // command-guard hook from blockedCommands
  if (harness.enforcement.blockedCommands.length > 0) {
    const patterns = harness.enforcement.blockedCommands
      .map((c) => `"${c}"`)
      .join(" ");

    preToolUse.push({
      id: "harness-command-guard",
      matcher: "Bash",
      description: "Blocks dangerous shell commands",
      inline: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
DANGEROUS_PATTERNS=(${patterns})
for pattern in "\${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qF "$pattern"; then
    echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: dangerous command blocked\\"}"
    exit 0
  fi
done
exit 0
`,
    });
  }

  // postSave hooks
  for (let i = 0; i < harness.enforcement.postSave.length; i++) {
    const ps = harness.enforcement.postSave[i];
    postToolUse.push({
      id: `harness-post-save-${i}`,
      matcher: "Edit|Write",
      description: `Runs ${ps.command} on ${ps.pattern} files after save`,
      inline: `#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
[[ -z "$FILE_PATH" ]] && exit 0
if [[ "$FILE_PATH" == ${ps.pattern} ]]; then
  ${ps.command} "$FILE_PATH" 2>/dev/null || true
fi
exit 0
`,
    });
  }

  return {
    presets: ["harness"],
    variables,
    claudeMdSections,
    hooks: {
      preToolUse,
      postToolUse,
    },
    settings: {
      permissions: {
        allow: harness.permissions.allow,
        deny: harness.permissions.deny,
      },
    },
  };
}
