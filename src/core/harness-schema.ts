import { z } from "zod";
import { HookEntrySchema } from "../catalog/types.js";

export const HarnessConfigSchema = z.object({
  version: z.literal("1.0").default("1.0"),

  // Project info (from NL parsing)
  project: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    stacks: z.array(z.object({
      name: z.string(),
      framework: z.string(),
      language: z.string(),
      packageManager: z.string().optional(),
      testRunner: z.string().optional(),
      linter: z.string().optional(),
    })),
  }),

  // Rules injected into CLAUDE.md
  rules: z.array(z.object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    priority: z.number().default(50),
  })),

  // Enforcement hooks
  enforcement: z.object({
    preCommit: z.array(z.string()).default([]),
    blockedPaths: z.array(z.string()).default([]),
    blockedCommands: z.array(z.string()).default([]),
    postSave: z.array(z.object({
      pattern: z.string(),
      command: z.string(),
    })).default([]),
  }).default({}),

  // Catalog-based hooks (v2)
  hooks: z.array(HookEntrySchema).default([]),

  // Permissions
  permissions: z.object({
    allow: z.array(z.string()).default([]),
    deny: z.array(z.string()).default([]),
  }).default({}),
});

export type HarnessConfig = z.infer<typeof HarnessConfigSchema>;
