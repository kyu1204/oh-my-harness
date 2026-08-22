export interface HookDefinition {
  id: string;
  matcher: string;
  description?: string;
  script?: string;
  inline?: string;
  variables?: Record<string, unknown>;
  // "ask" escalates to the user instead of hard-blocking (Claude); defaults to
  // "block". Threaded into the generated hook script's _emit_decision.
  mode?: "block" | "ask";
}

export interface ClaudeMdSection {
  id: string;
  title: string;
  content?: string;
  template?: string;
  priority: number;
}

export interface HooksConfig {
  preToolUse?: HookDefinition[];
  postToolUse?: HookDefinition[];
  sessionStart?: HookDefinition[];
  notification?: HookDefinition[];
  configChange?: HookDefinition[];
  worktreeCreate?: HookDefinition[];
}

export interface SettingsConfig {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
}

export type Variables = Record<string, string | number | boolean | string[]>;

export interface LoopConfig {
  /** Single source of truth for goal gates, task checkboxes and progress log. */
  ledger: string;
  /** Directory holding per-task work orders the loop executes verbatim. */
  workOrders: string;
  /** Model the implementation loop runs on. Never left unset — an unspecified
   *  model silently falls back to the session default (the top tier). */
  model: string;
  /** Whole-line termination signal. Matched with `grep -qx`, never `-q`. */
  sentinel: string;
  /** Seconds between successful iterations. */
  interval: number;
  /** Seconds to back off after repeated waiting-on-a-human BLOCKED turns. Kept
   *  separate from the limit and empty-output backoffs: a task waiting on the
   *  architect is not a failure, and conflating them burns tokens spinning. */
  blockedBackoff: number;
  /** Paths and task ids the loop must never touch (architect-owned). */
  architectOnly: string[];
  /** Run the loop in its own git worktree so the architect can keep working. */
  isolate: boolean;
  /** Agent runtime that drives the iterations. */
  runtime: "claude" | "codex" | "pi";
}

export interface MergedConfig {
  presets: string[];
  variables: Variables;
  claudeMdSections: ClaudeMdSection[];
  hooks: Required<HooksConfig>;
  settings: Required<SettingsConfig>;
  catalogErrors?: string[];
  /** Present only when the loop-engine block is configured. */
  loop?: LoopConfig;
}
