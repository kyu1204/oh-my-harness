import type { HarnessConfig } from "./harness-schema.js";
import type { MergedConfig, ClaudeMdSection, Variables } from "./preset-types.js";
import type { HookEntry } from "../catalog/types.js";

/**
 * Converts legacy enforcement fields into catalog-based HookEntry[].
 * This allows old harness.yaml configs with enforcement to be processed
 * through the unified catalog pipeline.
 */
export function convertEnforcementToHooks(enforcement: HarnessConfig["enforcement"]): HookEntry[] {
  const hooks: HookEntry[] = [];

  // preCommit → commit-test-gate or commit-typecheck-gate
  for (const cmd of enforcement.preCommit) {
    if (/\btsc\b/.test(cmd)) {
      hooks.push({ block: "commit-typecheck-gate", params: { typecheckCommand: cmd } });
    } else {
      hooks.push({ block: "commit-test-gate", params: { testCommand: cmd } });
    }
  }

  // blockedPaths → path-guard
  if (enforcement.blockedPaths.length > 0) {
    hooks.push({ block: "path-guard", params: { blockedPaths: enforcement.blockedPaths } });
  }

  // blockedCommands → command-guard
  if (enforcement.blockedCommands.length > 0) {
    hooks.push({ block: "command-guard", params: { patterns: enforcement.blockedCommands } });
  }

  // postSave → lint-on-save (each entry)
  for (const ps of enforcement.postSave) {
    hooks.push({ block: "lint-on-save", params: { filePattern: ps.pattern, command: ps.command } });
  }

  return hooks;
}

/**
 * Merges enforcement-derived hooks with explicit harness.hooks,
 * deduplicating by block id (explicit hooks take priority).
 */
export function mergeEnforcementAndHooks(harness: HarnessConfig): HookEntry[] {
  const enforcementHooks = convertEnforcementToHooks(harness.enforcement);
  const explicitHooks = harness.hooks ?? [];

  // Explicit hooks take priority — only keep enforcement hooks for blocks
  // not already covered by explicit hooks
  const explicitBlockIds = new Set(explicitHooks.map((h) => h.block));
  const uniqueEnforcementHooks = enforcementHooks.filter(
    (h) => !explicitBlockIds.has(h.block),
  );

  return [...uniqueEnforcementHooks, ...explicitHooks];
}

/**
 * Converts HarnessConfig to MergedConfig.
 * No longer generates inline enforcement scripts — enforcement is converted
 * to catalog hook entries and processed through the v2 catalog pipeline.
 */
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

  return {
    presets: ["harness"],
    variables,
    claudeMdSections,
    hooks: {
      preToolUse: [],
      postToolUse: [],
      sessionStart: [],
      notification: [],
      configChange: [],
      worktreeCreate: [],
    },
    settings: {
      permissions: {
        allow: harness.permissions.allow,
        deny: harness.permissions.deny,
      },
    },
  };
}
