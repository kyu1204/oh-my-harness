import { promises as fs } from "node:fs";
import path from "node:path";
import type { MergedConfig } from "../core/preset-types.js";
import type { HooksOutput } from "./hooks.js";

export interface GenerateSettingsOptions {
  projectDir: string;
  config: MergedConfig;
  hooksOutput: HooksOutput;
}

export async function generateSettings(options: GenerateSettingsOptions): Promise<void> {
  const { projectDir, config, hooksOutput } = options;
  const claudeDir = path.join(projectDir, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");

  // Read existing settings if present
  let existing: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(settingsPath, "utf-8");
    existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // File doesn't exist or is invalid JSON — start fresh
  }

  // Deep merge permissions: preserve existing, add managed entries
  const existingPermissions = (existing.permissions ?? {}) as {
    allow?: string[];
    deny?: string[];
  };

  const mergedAllow = Array.from(
    new Set([...(existingPermissions.allow ?? []), ...(config.settings.permissions.allow ?? [])]),
  );
  const mergedDeny = Array.from(
    new Set([...(existingPermissions.deny ?? []), ...(config.settings.permissions.deny ?? [])]),
  );

  // Preserve managedAt if content is unchanged
  const existingMeta = (existing._ohMyHarness ?? {}) as { managedAt?: string };
  const previousManagedAt = existingMeta.managedAt;

  const result: Record<string, unknown> = {
    ...existing,
    permissions: {
      ...existingPermissions,
      allow: mergedAllow,
      deny: mergedDeny,
    },
    hooks: hooksOutput.hooksConfig,
    _ohMyHarness: {
      managedAt: "__PLACEHOLDER__",
      presets: config.presets,
    },
  };

  // Compare content without timestamp to decide if managedAt should update
  const newContent = JSON.stringify(result, null, 2) + "\n";
  const oldMeta =
    existing._ohMyHarness && typeof existing._ohMyHarness === "object" && !Array.isArray(existing._ohMyHarness)
      ? { ...(existing._ohMyHarness as Record<string, unknown>) }
      : {};
  const oldResultForCompare: Record<string, unknown> = {
    ...existing,
    _ohMyHarness: oldMeta,
  };
  if (oldMeta.managedAt) {
    oldMeta.managedAt = "__PLACEHOLDER__";
  }
  const oldContent = JSON.stringify(oldResultForCompare, null, 2) + "\n";

  const managedAt = newContent === oldContent && previousManagedAt
    ? previousManagedAt
    : new Date().toISOString();

  (result._ohMyHarness as Record<string, unknown>).managedAt = managedAt;

  await fs.mkdir(claudeDir, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(result, null, 2) + "\n", "utf-8");
}
