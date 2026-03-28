import { z } from "zod";

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "PreCompact"
  | "PostCompact"
  | "Notification"
  | "Stop"
  | "SubagentStop"
  | "PreBash"
  | "PostBash"
  | "PreEdit"
  | "PostEdit"
  | "PreRead"
  | "PostRead"
  | "PreWrite"
  | "PostWrite"
  | "SessionStart"
  | "SessionEnd"
  | "PreToolResult"
  | "PostToolResult"
  | "UserPromptSubmit"
  | "ConfigChange"
  | "WorktreeCreate"
  | "WorktreeRemove"; // TODO: wire WorktreeRemove through runtime pipeline when cleanup blocks are needed

export type BuildingBlockCategory =
  | "git"
  | "quality"
  | "security"
  | "notification"
  | "formatting"
  | "custom"
  | "auto-fix"
  | "automation"
  | "file-protection"
  | "audit";

export interface ParamDefinition {
  name: string;
  type: "string" | "boolean" | "number" | "string[]";
  description: string;
  required: boolean;
  default?: unknown;
}

export interface BuildingBlock {
  id: string;
  name: string;
  description: string;
  category: BuildingBlockCategory;
  event: HookEvent;
  matcher?: string;
  canBlock: boolean;
  params: ParamDefinition[];
  template: string;
  tags: string[];
}

export interface HookEntry {
  block: string;
  params: Record<string, unknown>;
}

export const ParamDefinitionSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "boolean", "number", "string[]"]),
  description: z.string(),
  required: z.boolean(),
  default: z.unknown().optional(),
});

export const BuildingBlockSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(["git", "quality", "security", "notification", "formatting", "custom", "auto-fix", "automation", "file-protection", "audit"]),
  event: z.enum(["PreToolUse", "PostToolUse", "PreCompact", "PostCompact", "Notification", "Stop", "SubagentStop", "PreBash", "PostBash", "PreEdit", "PostEdit", "PreRead", "PostRead", "PreWrite", "PostWrite", "SessionStart", "SessionEnd", "PreToolResult", "PostToolResult", "UserPromptSubmit", "ConfigChange", "WorktreeCreate", "WorktreeRemove"]),
  matcher: z.string().optional(),
  canBlock: z.boolean(),
  params: z.array(ParamDefinitionSchema),
  template: z.string(),
  tags: z.array(z.string()),
});

export const HookEntrySchema = z.object({
  block: z.string(),
  params: z.record(z.unknown()).default({}),
});
