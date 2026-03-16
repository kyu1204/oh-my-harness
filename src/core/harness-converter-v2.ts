import type { HarnessConfig } from "./harness-schema.js";
import type { MergedConfig, HookDefinition } from "./preset-types.js";
import { harnessToMergedConfig } from "./harness-converter.js";
import type { CatalogRegistry } from "../catalog/registry.js";
import { createDefaultRegistry } from "../catalog/registry.js";
import { convertHookEntries } from "../catalog/converter.js";

export interface MergedConfigV2 extends MergedConfig {
  catalogErrors?: string[];
}

export async function harnessToMergedConfigV2(
  harness: HarnessConfig,
  registry?: CatalogRegistry,
  projectDir?: string,
): Promise<MergedConfigV2> {
  // Start with v1 conversion (handles enforcement field)
  const base = harnessToMergedConfig(harness);

  // If no hooks or empty, return base config unchanged
  if (!harness.hooks || harness.hooks.length === 0) {
    return { ...base };
  }

  // Resolve registry — use provided one or create the default
  const resolvedRegistry = registry ?? (await createDefaultRegistry());

  const catalogResult = await convertHookEntries(harness.hooks, resolvedRegistry, projectDir ?? ".");

  // If there are errors, return base config with catalogErrors attached
  if (catalogResult.errors.length > 0) {
    return { ...base, catalogErrors: catalogResult.errors };
  }

  // Convert hooksConfig entries from catalog into HookDefinition format.
  // Catalog hooks are appended after v1 hooks so v2 catalog takes precedence
  // (last writer wins in Claude settings; appended = higher effective priority).
  const additionalPreToolUse: HookDefinition[] = [];
  const additionalPostToolUse: HookDefinition[] = [];

  for (const [event, entries] of Object.entries(catalogResult.hooksConfig)) {
    for (const entry of entries) {
      // Find the block id from the script path: .claude/hooks/<block-id>.sh
      const blockId = entry.command.replace(/.*\/(.+)\.sh$/, "$1");
      const hookDef: HookDefinition = {
        id: `catalog-${blockId}`,
        matcher: entry.matcher ?? "",
        description: `Catalog block: ${blockId}`,
        inline: catalogResult.scripts.get(entry.command),
      };

      if (event === "PreToolUse") {
        additionalPreToolUse.push(hookDef);
      } else if (event === "PostToolUse") {
        additionalPostToolUse.push(hookDef);
      }
      // Other events (SessionStart, etc.) are not yet mapped to MergedConfig hooks
    }
  }

  return {
    ...base,
    hooks: {
      preToolUse: [...base.hooks.preToolUse, ...additionalPreToolUse],
      postToolUse: [...base.hooks.postToolUse, ...additionalPostToolUse],
    },
  };
}
