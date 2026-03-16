import path from "path";
import type { HookEntry } from "./types.js";
import type { CatalogRegistry } from "./registry.js";
import { renderTemplate, validateParams } from "./template-engine.js";

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
  projectDir: string,
): Promise<ConvertResult> {
  const hooksConfig: Record<string, HookConfigEntry[]> = {};
  const scripts: Map<string, string> = new Map();
  const errors: string[] = [];

  for (const entry of entries) {
    const block = registry.get(entry.block);

    if (!block) {
      errors.push(`Unknown block id: "${entry.block}"`);
      continue;
    }

    const paramErrors = validateParams(block, entry.params as Record<string, unknown>);
    if (paramErrors.length > 0) {
      errors.push(...paramErrors);
      continue;
    }

    const scriptContent = renderTemplate(block.template, entry.params as Record<string, unknown>);
    const scriptName = `${entry.block}.sh`;
    const scriptPath = path.join(projectDir, ".claude", "hooks", scriptName);
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
