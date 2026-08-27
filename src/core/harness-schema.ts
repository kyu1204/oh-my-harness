import { z } from "zod";
import { HookEntrySchema } from "../catalog/types.js";

// Loop paths are compared as raw prefixes by loop-guard, so they must be in
// the canonical project-relative form a tool call reports: no leading "/",
// no "." or ".." segments, no trailing "/". Nothing is ever interpolated into
// shell (the supervisor spawns argv arrays), so shell metacharacters are fine.
const relPath = z
  .string()
  .min(1)
  // These values are rendered into loop-guard's bash template; a quote,
  // backtick, $ or backslash there kills or bypasses the guard. (The runner
  // itself spawns argv arrays and would not care.)
  .regex(/^[^'"`$\\\r\n]+$/, "must not contain quotes, backticks, $, backslashes or CR/LF")
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
    ledger: relPath.default("WORKPLAN.md"),
    workOrders: relPath.default("docs/work-orders"),
    model: z.string().default("sonnet"),
    sentinel: z
      .string()
      .min(1)
      // Matched against TRIMMED output lines; surrounding whitespace or an
      // embedded newline could never match, so completion would be unreachable.
      .refine((v) => v === v.trim() && !/[\r\n\t]/.test(v), "must be a single trimmed line")
      .default("OMH_GOAL_COMPLETE"),
    interval: z.number().positive().default(120),
    blockedBackoff: z.number().positive().default(1800),
    limitBackoff: z.number().positive().default(1800),
    emptyBackoff: z.number().positive().default(300),
    stallStreak: z.number().int().positive().default(3),
    turnTimeout: z.number().positive().default(7200),
    architectOnly: z.array(relPath).default([]),
    isolate: z.boolean().default(true),
    runtime: z.enum(["claude", "codex", "pi"]).default("claude"),
  })
    // Architect assets (the work-orders directory) are re-synced into the
    // worktree every iteration; a ledger inside it would be rolled back to
    // the architect's copy each turn, erasing the loop's progress.
    .refine((l) => !(l.ledger === l.workOrders || l.ledger.startsWith(`${l.workOrders}/`)), {
      message: "loop.ledger must not live inside loop.workOrders",
      path: ["ledger"],
    })
    .default({}),

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
