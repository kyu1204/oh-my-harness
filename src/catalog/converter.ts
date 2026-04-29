import type { HookEntry } from "./types.js";
import type { CatalogRegistry } from "./registry.js";
import { renderTemplate, validateParams, applyDefaults } from "./template-engine.js";
import { OMH_HOOKS_DIR } from "../utils/paths.js";

export interface HookConfigEntry {
  type: "command";
  command: string;
  matcher?: string;
}

export interface ConvertResult {
  hooksConfig: Record<string, HookConfigEntry[]>;
  scripts: Map<string, string>;
  errors: string[];
}

export async function convertHookEntries(
  entries: HookEntry[],
  registry: CatalogRegistry,
  _projectDir: string,
): Promise<ConvertResult> {
  const hooksConfig: Record<string, HookConfigEntry[]> = {};
  const scripts: Map<string, string> = new Map();
  const errors: string[] = [];
  const blockInstanceCount = new Map<string, number>();

  for (const entry of entries) {
    const block = registry.get(entry.block);

    if (!block) {
      errors.push(`Unknown block id: "${entry.block}"`);
      continue;
    }

    const resolvedParams = applyDefaults(block, entry.params as Record<string, unknown>);
    const paramErrors = validateParams(block, resolvedParams);
    if (paramErrors.length > 0) {
      errors.push(...paramErrors);
      continue;
    }

    let scriptContent: string;
    try {
      scriptContent = renderTemplate(block.template, resolvedParams);
    } catch (err) {
      errors.push(`Failed to render block "${entry.block}": ${(err as Error).message}`);
      continue;
    }

    // Support multiple instances of the same block with different params
    const count = blockInstanceCount.get(entry.block) ?? 0;
    blockInstanceCount.set(entry.block, count + 1);
    const scriptName = count === 0 ? `${entry.block}.sh` : `${entry.block}-${count}.sh`;
    const scriptPath = `${OMH_HOOKS_DIR}/${scriptName}`;
    scripts.set(scriptPath, scriptContent);

    const hookEntry: HookConfigEntry = {
      type: "command",
      command: scriptPath,
    };

    if (block.matcher) {
      hookEntry.matcher = block.matcher;
    }

    const event = block.event;
    if (!hooksConfig[event]) {
      hooksConfig[event] = [];
    }
    hooksConfig[event].push(hookEntry);
  }

  return { hooksConfig, scripts, errors };
}
