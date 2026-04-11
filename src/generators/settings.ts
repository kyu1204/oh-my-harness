import { promises as fs } from "node:fs";
import path from "node:path";
import type { MergedConfig } from "../core/preset-types.js";
import type { HooksOutput } from "./hooks.js";

export interface GenerateSettingsOptions {
  projectDir: string;
  config: MergedConfig;
  hooksOutput: HooksOutput;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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

  // Deep merge permissions: preserve user-added, replace managed entries
  const existingPermissions =
    existing.permissions && typeof existing.permissions === "object" && !Array.isArray(existing.permissions)
      ? (existing.permissions as Record<string, unknown>)
      : {};
  const existingAllow = asStringArray(existingPermissions.allow);
  const existingDeny = asStringArray(existingPermissions.deny);

  const existingMeta = (existing._ohMyHarness ?? {}) as {
    managedAt?: string;
    managedPermissions?: { allow?: unknown; deny?: unknown };
  };

  // Previous managed permissions (empty if legacy settings without tracking)
  const prevManaged =
    existingMeta.managedPermissions &&
      typeof existingMeta.managedPermissions === "object" &&
      !Array.isArray(existingMeta.managedPermissions)
      ? existingMeta.managedPermissions
      : {};
  const prevManagedAllow = new Set(asStringArray(prevManaged.allow));
  const prevManagedDeny = new Set(asStringArray(prevManaged.deny));

  // New managed permissions from current config
  const newManagedAllow = asStringArray(config.settings.permissions.allow);
  const newManagedDeny = asStringArray(config.settings.permissions.deny);

  // User-added = existing - previous managed
  const userAllow = existingAllow.filter((p) => !prevManagedAllow.has(p));
  const userDeny = existingDeny.filter((p) => !prevManagedDeny.has(p));
  const userAllowSet = new Set(userAllow);
  const userDenySet = new Set(userDeny);

  // Only track permissions as managed if they were not already user-owned.
  const trackedManagedAllow = newManagedAllow.filter((p) => !userAllowSet.has(p));
  const trackedManagedDeny = newManagedDeny.filter((p) => !userDenySet.has(p));

  // Final = user-added + new managed (deduplicated)
  const mergedAllow = Array.from(new Set([...userAllow, ...newManagedAllow]));
  const mergedDeny = Array.from(new Set([...userDeny, ...newManagedDeny]));
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
      managedPermissions: {
        allow: trackedManagedAllow,
        deny: trackedManagedDeny,
      },
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
