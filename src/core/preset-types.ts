import { z } from "zod";

// --- Hook Definitions ---

export const HookDefinitionSchema = z.object({
  id: z.string(),
  matcher: z.string(),
  description: z.string().optional(),
  script: z.string().optional(), // path to .hbs template
  inline: z.string().optional(), // inline script content
  variables: z.record(z.unknown()).optional(),
});

export type HookDefinition = z.infer<typeof HookDefinitionSchema>;

// --- CLAUDE.md Section ---

export const ClaudeMdSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string().optional(), // inline content
  template: z.string().optional(), // path to .hbs template
  priority: z.number().default(50), // lower = higher in file
});

export type ClaudeMdSection = z.infer<typeof ClaudeMdSectionSchema>;

// --- Hooks Config ---

export const HooksConfigSchema = z.object({
  preToolUse: z.array(HookDefinitionSchema).optional(),
  postToolUse: z.array(HookDefinitionSchema).optional(),
  sessionStart: z.array(HookDefinitionSchema).optional(),
  notification: z.array(HookDefinitionSchema).optional(),
  configChange: z.array(HookDefinitionSchema).optional(),
  worktreeCreate: z.array(HookDefinitionSchema).optional(),
});

export type HooksConfig = z.infer<typeof HooksConfigSchema>;

// --- Settings Config ---

export const SettingsConfigSchema = z.object({
  permissions: z
    .object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    })
    .optional(),
});

export type SettingsConfig = z.infer<typeof SettingsConfigSchema>;

// --- Variables ---

export const VariablesSchema = z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]));

export type Variables = z.infer<typeof VariablesSchema>;

// --- Preset Config (preset.yaml) ---

export const PresetConfigSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  version: z.string().default("1.0.0"),
  extends: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  variables: VariablesSchema.optional(),
  claudeMd: z
    .object({
      sections: z.array(ClaudeMdSectionSchema),
    })
    .optional(),
  hooks: HooksConfigSchema.optional(),
  settings: SettingsConfigSchema.optional(),
});

export type PresetConfig = z.infer<typeof PresetConfigSchema>;

// --- Merged Config (result of combining presets) ---

export interface MergedConfig {
  presets: string[]; // names of applied presets in order
  variables: Variables;
  claudeMdSections: ClaudeMdSection[]; // sorted by priority
  hooks: Required<HooksConfig>;
  settings: Required<SettingsConfig>;
}
