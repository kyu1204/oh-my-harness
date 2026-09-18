import type { HarnessConfig } from "./harness-schema.js";
import type { MergedConfig, HookDefinition, HooksConfig, ClaudeMdSection, Variables } from "./merged-config.js";
import type { CatalogRegistry } from "../catalog/registry.js";
import type { HookEntry } from "../catalog/types.js";
import { createDefaultRegistry } from "../catalog/registry.js";
import { convertHookEntries } from "../catalog/converter.js";
import { renderProtocolSection } from "../loop/protocol.js";

function harnessToMergedConfig(harness: HarnessConfig): MergedConfig {
  const variables: Variables = {};
  if (harness.project.stacks.length > 0) {
    const primary = harness.project.stacks[0];
    variables.framework = primary.framework;
    variables.language = primary.language;
    if (primary.packageManager) variables.packageManager = primary.packageManager;
    if (primary.testRunner) variables.testRunner = primary.testRunner;
    if (primary.linter) variables.linter = primary.linter;
  }

  const claudeMdSections: ClaudeMdSection[] = harness.rules
    .map((rule) => ({ id: rule.id, title: rule.title, content: rule.content, priority: rule.priority }))
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));

  if (harness.loop?.enabled) {
    claudeMdSections.push({
      id: "omh-loop-protocol",
      title: "Autonomous Loop Protocol",
      content: renderProtocolSection(harness.loop),
      priority: 90,
    });
  }

  return {
    presets: ["harness"],
    variables,
    claudeMdSections,
    hooks: { preToolUse: [], postToolUse: [], sessionStart: [], notification: [], configChange: [], worktreeCreate: [], stop: [] },
    settings: { permissions: { allow: harness.permissions.allow, deny: harness.permissions.deny } },
    ...(harness.loop?.enabled ? { loop: harness.loop } : {}),
  };
}

function convertEnforcementToHooks(enforcement: HarnessConfig["enforcement"]): HookEntry[] {
  const hooks: HookEntry[] = [];
  for (const cmd of enforcement.preCommit) {
    if (/\btsc\b/.test(cmd)) {
      hooks.push({ block: "commit-typecheck-gate", params: { typecheckCommand: cmd } });
    } else {
      hooks.push({ block: "commit-test-gate", params: { testCommand: cmd } });
    }
  }
  if (enforcement.blockedPaths.length > 0) {
    hooks.push({ block: "path-guard", params: { blockedPaths: enforcement.blockedPaths } });
  }
  if (enforcement.blockedCommands.length > 0) {
    hooks.push({ block: "command-guard", params: { patterns: enforcement.blockedCommands } });
  }
  for (const ps of enforcement.postSave) {
    hooks.push({ block: "lint-on-save", params: { filePattern: ps.pattern, command: ps.command } });
  }
  return hooks;
}

// A harness that enforces anything also guards itself: without this an agent
// could delete or rewrite the hooks through Bash (#113), skip git hooks or
// force-push main (#98, #99, #114). An explicit entry keeps its mode/params;
// custom registries without the block are skipped.
export const ALWAYS_ON_GUARDS = ["harness-guard", "no-verify-guard", "force-push-guard"] as const;

function addAlwaysOnGuards(entries: HookEntry[], registry: { has(id: string): boolean }): void {
  if (entries.length === 0) return;
  for (const id of ALWAYS_ON_GUARDS) {
    if (registry.has(id) && !entries.some((h) => h.block === id)) {
      entries.push({ block: id, params: {}, mode: "block" });
    }
  }
}

// The loop engine brings its guard along. An explicit loop-guard entry may
// choose its mode, but the paths it protects always come from the loop
// config — otherwise an empty explicit entry would silently unguard the
// real work-order directory.
function addLoopGuard(entries: HookEntry[], harness: HarnessConfig): void {
  if (!harness.loop?.enabled) return;
  const loopParams = { workOrders: harness.loop.workOrders, architectOnly: harness.loop.architectOnly };
  const explicit = entries.find((h) => h.block === "loop-guard");
  if (explicit) {
    explicit.params = { ...explicit.params, ...loopParams };
  } else {
    entries.push({ block: "loop-guard", params: loopParams, mode: "block" });
  }
}

/**
 * The hook entries a harness really runs: enforcement-derived + explicit +
 * loop-guard (when the loop is on) + the always-on guards, in the order the
 * generator emits them. `omh test` and `omh stats` use this so they see the
 * same set (QA: they used to miss the always-on guards).
 */
export function effectiveHookEntries(harness: HarnessConfig, registry: { has(id: string): boolean }): HookEntry[] {
  const entries = mergeEnforcementAndHooks(harness);
  addLoopGuard(entries, harness);
  addAlwaysOnGuards(entries, registry);
  return entries;
}

export function mergeEnforcementAndHooks(harness: HarnessConfig): HookEntry[] {
  const enforcementHooks = convertEnforcementToHooks(harness.enforcement);
  const explicitHooks = harness.hooks ?? [];
  const explicitBlockIds = new Set(explicitHooks.map((h) => h.block));
  return [...enforcementHooks.filter((h) => !explicitBlockIds.has(h.block)), ...explicitHooks];
}

/** Maps Claude Code event names to HooksConfig field names */
const eventToField: Record<string, keyof HooksConfig> = {
  PreToolUse: "preToolUse",
  PostToolUse: "postToolUse",
  SessionStart: "sessionStart",
  Notification: "notification",
  ConfigChange: "configChange",
  WorktreeCreate: "worktreeCreate",
  Stop: "stop",
};

export async function harnessToMergedConfigV2(
  harness: HarnessConfig,
  registry?: CatalogRegistry,
  projectDir?: string,
): Promise<MergedConfig> {
  // Start with base conversion (rules, variables, permissions — no inline enforcement scripts)
  const base = harnessToMergedConfig(harness);

  // Merge enforcement-derived hooks with explicit hooks (dedup by block id)
  const allHookEntries = mergeEnforcementAndHooks(harness);

  addLoopGuard(allHookEntries, harness);

  // If no hook entries at all, return base config unchanged
  if (allHookEntries.length === 0) {
    return { ...base };
  }

  // Resolve registry — use provided one or create the default
  const resolvedRegistry = registry ?? (await createDefaultRegistry());

  addAlwaysOnGuards(allHookEntries, resolvedRegistry);

  const catalogResult = await convertHookEntries(allHookEntries, resolvedRegistry, projectDir ?? ".");

  // Convert hooksConfig entries from catalog into HookDefinition format.
  // Errors are reported as warnings but don't block valid hooks.
  const additionalHooks: Record<string, HookDefinition[]> = {};

  for (const [event, entries] of Object.entries(catalogResult.hooksConfig)) {
    const field = eventToField[event];
    if (!field) continue; // unknown event — skip

    if (!additionalHooks[field]) {
      additionalHooks[field] = [];
    }

    for (const entry of entries) {
      // Find the block id from the script path: <hooks-dir>/<block-id>.sh
      const blockId = entry.command.replace(/.*\/(.+)\.sh$/, "$1");
      const hookDef: HookDefinition = {
        id: `catalog-${blockId}`,
        matcher: entry.matcher ?? "",
        description: `Catalog block: ${blockId}`,
        inline: catalogResult.scripts.get(entry.command),
        mode: entry.mode ?? "block",
      };

      additionalHooks[field].push(hookDef);
    }
  }

  const mergedHooks: Required<HooksConfig> = {
    preToolUse: [...base.hooks.preToolUse, ...(additionalHooks.preToolUse ?? [])],
    postToolUse: [...base.hooks.postToolUse, ...(additionalHooks.postToolUse ?? [])],
    sessionStart: [...(base.hooks.sessionStart ?? []), ...(additionalHooks.sessionStart ?? [])],
    notification: [...(base.hooks.notification ?? []), ...(additionalHooks.notification ?? [])],
    configChange: [...(base.hooks.configChange ?? []), ...(additionalHooks.configChange ?? [])],
    worktreeCreate: [...(base.hooks.worktreeCreate ?? []), ...(additionalHooks.worktreeCreate ?? [])],
    stop: [...(base.hooks.stop ?? []), ...(additionalHooks.stop ?? [])],
  };

  return {
    ...base,
    hooks: mergedHooks,
    ...(catalogResult.errors.length > 0 ? { catalogErrors: catalogResult.errors } : {}),
  };
}
