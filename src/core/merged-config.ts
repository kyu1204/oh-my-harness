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

export interface MergedConfig {
  presets: string[];
  variables: Variables;
  claudeMdSections: ClaudeMdSection[];
  hooks: Required<HooksConfig>;
  settings: Required<SettingsConfig>;
  catalogErrors?: string[];
}
