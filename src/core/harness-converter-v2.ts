import type { HarnessConfig } from "./harness-schema.js";
import type { MergedConfig, HookDefinition, HooksConfig } from "./preset-types.js";
import { harnessToMergedConfig, mergeEnforcementAndHooks } from "./harness-converter.js";
import type { CatalogRegistry } from "../catalog/registry.js";
import { createDefaultRegistry } from "../catalog/registry.js";
import { convertHookEntries } from "../catalog/converter.js";

export interface MergedConfigV2 extends MergedConfig {
  catalogErrors?: string[];
}

/** Maps Claude Code event names to HooksConfig field names */
const eventToField: Record<string, keyof HooksConfig> = {
  PreToolUse: "preToolUse",
  PostToolUse: "postToolUse",
  SessionStart: "sessionStart",
  Notification: "notification",
  ConfigChange: "configChange",
  WorktreeCreate: "worktreeCreate",
};

export async function harnessToMergedConfigV2(
  harness: HarnessConfig,
  registry?: CatalogRegistry,
  projectDir?: string,
): Promise<MergedConfigV2> {
  // Start with base conversion (rules, variables, permissions — no inline enforcement scripts)
  const base = harnessToMergedConfig(harness);

  // Merge enforcement-derived hooks with explicit hooks (dedup by block id)
  const allHookEntries = mergeEnforcementAndHooks(harness);

  // If no hook entries at all, return base config unchanged
  if (allHookEntries.length === 0) {
    return { ...base };
  }

  // Resolve registry — use provided one or create the default
  const resolvedRegistry = registry ?? (await createDefaultRegistry());

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
      // Find the block id from the script path: .claude/hooks/<block-id>.sh
      const blockId = entry.command.replace(/.*\/(.+)\.sh$/, "$1");
      const hookDef: HookDefinition = {
        id: `catalog-${blockId}`,
        matcher: entry.matcher ?? "",
        description: `Catalog block: ${blockId}`,
        inline: catalogResult.scripts.get(entry.command),
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
  };

  return {
    ...base,
    hooks: mergedHooks,
    ...(catalogResult.errors.length > 0 ? { catalogErrors: catalogResult.errors } : {}),
  };
}
