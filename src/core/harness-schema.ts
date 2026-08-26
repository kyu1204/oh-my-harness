import { z } from "zod";
import { HookEntrySchema } from "../catalog/types.js";

// Loop path values are interpolated into generated shell (the runner and the
// loop-guard template). Rejecting shell metacharacters up front keeps a stray
// quote in harness.yaml from breaking — or, worse, executing inside — a hook.
const shellSafePath = z
  .string()
  .min(1)
  .regex(/^[^'"`$\\\n]+$/, "must not contain quotes, backticks, $ or backslashes")
  // loop-guard compares raw prefixes, so "./docs/x", "/abs/x" and "docs/x/"
  // would silently fail to match the paths a tool call actually reports.
  .refine(
    (p) => !p.startsWith("/") && p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== ".."),
    "must be a canonical project-relative path (no leading /, ./, ../ or trailing /)",
  );

export const HarnessConfigSchema = z.object({
  version: z.literal("1.0").default("1.0"),

  // Sharing / community metadata (optional — used for omh sync portability and future marketplace)
  name: z.string().optional(),
  description: z.string().optional(),
  harnessVersion: z.string().optional(),
  tags: z.array(z.string()).optional(),
  extends: z.array(z.string()).optional(), // stub — reserved for future marketplace composition

  // Project info (from NL parsing or preset detector). Optional so a minimal
  // hooks-only harness.yaml (the shape shown in README) still validates.
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
    })).default([]),
  }).default({ stacks: [] }),

  // Rules injected into CLAUDE.md
  rules: z.array(z.object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    priority: z.number().default(50),
  })).default([]),

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

  // Autonomous loop engine. Defaulted on: the runner does nothing until a
  // session explicitly starts it, so an unused loop costs nothing, and the
  // setup is already in place the moment someone asks for one.
  loop: z.object({
    enabled: z.boolean().default(true),
    ledger: shellSafePath.default("WORKPLAN.md"),
    workOrders: shellSafePath.default("docs/work-orders"),
    model: z.string().default("sonnet"),
    sentinel: z.string().min(1).default("OMH_GOAL_COMPLETE"),
    interval: z.number().positive().default(120),
    blockedBackoff: z.number().positive().default(1800),
    architectOnly: z.array(shellSafePath).default([]),
    isolate: z.boolean().default(true),
    runtime: z.enum(["claude", "codex", "pi"]).default("claude"),
  }).default({}),

  // Permissions
  permissions: z.object({
    allow: z.array(z.string()).default([]),
    deny: z.array(z.string()).default([]),
  }).default({}),
});

type ParsedHarnessConfig = z.infer<typeof HarnessConfigSchema>;

/**
 * Parsing always fills `loop` from its defaults, but hand-built configs (tests,
 * `buildMinimalHarnessConfig`) may omit it — so the type stays optional while
 * the schema stays defaulted-on.
 */
export type HarnessConfig = Omit<ParsedHarnessConfig, "loop"> & {
  loop?: ParsedHarnessConfig["loop"];
};
