import { promises as fs } from "node:fs";
import path from "node:path";
import type { MergedConfig } from "../core/merged-config.js";
import type { HooksOutput } from "./hooks.js";
import { isOmhHookCommand } from "../core/managed-hooks.js";

export interface GenerateSettingsOptions {
  projectDir: string;
  config: MergedConfig;
  hooksOutput: HooksOutput;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function preserveUserHooks(
  existingHooks: unknown,
  projectDir: string,
): Promise<Record<string, unknown[]>> {
  if (!isPlainObject(existingHooks)) return {};

  const preserved: Record<string, unknown[]> = {};
  for (const [event, entries] of Object.entries(existingHooks)) {
    if (!Array.isArray(entries)) {
      preserved[event] = [entries];
      continue;
    }

    for (const entry of entries) {
      if (!isPlainObject(entry) || !Array.isArray(entry.hooks)) {
        if (!preserved[event]) preserved[event] = [];
        preserved[event].push(entry);
        continue;
      }

      const userHooks: unknown[] = [];
      for (const hook of entry.hooks) {
        if (
          isPlainObject(hook) &&
          typeof hook.command === "string" &&
          await isOmhHookCommand(hook.command, projectDir)
        ) {
          continue;
        }
        userHooks.push(hook);
      }

      if (userHooks.length > 0) {
        if (!preserved[event]) preserved[event] = [];
        preserved[event].push({ ...entry, hooks: userHooks });
      }
    }
  }

  return preserved;
}

async function mergeHooksConfig(
  existingHooks: unknown,
  generatedHooks: HooksOutput["hooksConfig"],
  projectDir: string,
): Promise<Record<string, unknown[]>> {
  const preserved = await preserveUserHooks(existingHooks, projectDir);
  const merged: Record<string, unknown[]> = {};
  for (const [event, entries] of Object.entries(preserved)) {
    if (entries.length > 0) merged[event] = [...entries];
  }
  for (const [event, entries] of Object.entries(generatedHooks)) {
    if (!merged[event]) merged[event] = [];
    const seen = new Set(merged[event].map((entry) => JSON.stringify(entry)));
    for (const entry of entries) {
      const key = JSON.stringify(entry);
      if (!seen.has(key)) {
        merged[event].push(entry);
        seen.add(key);
      }
    }
  }
  return merged;
}

/**
 * Compute the final .claude/settings.json content (merging into existing
 * permissions / managed tracking) without writing it. The managedAt timestamp
 * is held stable when nothing else changes, so re-runs produce identical
 * content — this keeps drift detection from reporting false positives.
 */
export async function computeSettings(
  options: GenerateSettingsOptions,
): Promise<{ path: string; content: string }> {
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
  const mergedHooks = await mergeHooksConfig(existing.hooks, hooksOutput.hooksConfig, projectDir);

  const result: Record<string, unknown> = {
    ...existing,
    permissions: {
      ...existingPermissions,
      allow: mergedAllow,
      deny: mergedDeny,
    },
    hooks: mergedHooks,
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

  return { path: settingsPath, content: JSON.stringify(result, null, 2) + "\n" };
}

export async function generateSettings(options: GenerateSettingsOptions): Promise<void> {
  const { path: settingsPath, content } = await computeSettings(options);
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, content, "utf-8");
}
