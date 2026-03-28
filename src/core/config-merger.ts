import type { PresetConfig, MergedConfig, ClaudeMdSection, HookDefinition, Variables } from "./preset-types.js";

export function mergePresets(presets: PresetConfig[]): MergedConfig {
  const mergedVariables: Variables = {};
  const sectionsMap = new Map<string, ClaudeMdSection>();
  const preToolUseMap = new Map<string, HookDefinition>();
  const postToolUseMap = new Map<string, HookDefinition>();
  const sessionStartMap = new Map<string, HookDefinition>();
  const notificationMap = new Map<string, HookDefinition>();
  const configChangeMap = new Map<string, HookDefinition>();
  const worktreeCreateMap = new Map<string, HookDefinition>();
  const allowSet = new Set<string>();
  const denySet = new Set<string>();
  const presetNames: string[] = [];

  for (const preset of presets) {
    presetNames.push(preset.name);

    // Merge variables (later preset wins)
    if (preset.variables) {
      Object.assign(mergedVariables, preset.variables);
    }

    // Merge CLAUDE.md sections (deduplicate by id, later preset wins)
    if (preset.claudeMd?.sections) {
      for (const section of preset.claudeMd.sections) {
        sectionsMap.set(section.id, section);
      }
    }

    // Merge hooks (deduplicate by id, later preset wins)
    if (preset.hooks?.preToolUse) {
      for (const hook of preset.hooks.preToolUse) {
        preToolUseMap.set(hook.id, hook);
      }
    }
    if (preset.hooks?.postToolUse) {
      for (const hook of preset.hooks.postToolUse) {
        postToolUseMap.set(hook.id, hook);
      }
    }
    if (preset.hooks?.sessionStart) {
      for (const hook of preset.hooks.sessionStart) {
        sessionStartMap.set(hook.id, hook);
      }
    }
    if (preset.hooks?.notification) {
      for (const hook of preset.hooks.notification) {
        notificationMap.set(hook.id, hook);
      }
    }
    if (preset.hooks?.configChange) {
      for (const hook of preset.hooks.configChange) {
        configChangeMap.set(hook.id, hook);
      }
    }
    if (preset.hooks?.worktreeCreate) {
      for (const hook of preset.hooks.worktreeCreate) {
        worktreeCreateMap.set(hook.id, hook);
      }
    }

    // Merge settings (accumulate)
    if (preset.settings?.permissions?.allow) {
      for (const a of preset.settings.permissions.allow) allowSet.add(a);
    }
    if (preset.settings?.permissions?.deny) {
      for (const d of preset.settings.permissions.deny) denySet.add(d);
    }
  }

  // Sort sections by priority (lower = higher in file)
  const sortedSections = Array.from(sectionsMap.values()).sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));

  return {
    presets: presetNames,
    variables: mergedVariables,
    claudeMdSections: sortedSections,
    hooks: {
      preToolUse: Array.from(preToolUseMap.values()),
      postToolUse: Array.from(postToolUseMap.values()),
      sessionStart: Array.from(sessionStartMap.values()),
      notification: Array.from(notificationMap.values()),
      configChange: Array.from(configChangeMap.values()),
      worktreeCreate: Array.from(worktreeCreateMap.values()),
    },
    settings: {
      permissions: {
        allow: Array.from(allowSet),
        deny: Array.from(denySet),
      },
    },
  };
}
