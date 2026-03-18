import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HarnessConfig } from "../core/harness-schema.js";

const execFileAsync = promisify(execFile);

export interface ToolCheck {
  name: string;
  command: string;
  source: string;
  installCmd: string;
  installed: boolean;
}

export interface ToolRef {
  name: string;
  source: string;
  lookupCommand: string;
}

const INSTALL_HINTS: Record<string, string> = {
  eslint: "npm install -D eslint",
  prettier: "npm install -D prettier",
  ruff: "pip install ruff",
  black: "pip install black",
  mypy: "pip install mypy",
  pytest: "pip install pytest",
  vitest: "npm install -D vitest",
  tsc: "npm install -D typescript",
  npx: "npm install -g npx",
  biome: "npm install -D @biomejs/biome",
};

interface ExtractResult {
  name: string;
  lookupCommand: string;
}

function extractBinary(command: string): ExtractResult | undefined {
  const trimmed = command.trim();
  if (!trimmed) return undefined;

  const parts = trimmed.split(/\s+/);

  // Skip gradle wrapper commands (managed by project)
  if (parts[0] === "./gradlew" || parts[0] === "gradlew") return undefined;

  // npx [options] <tool> ... → skip option flags, extract first non-option token
  if (parts[0] === "npx") {
    let i = 1;
    while (i < parts.length && parts[i].startsWith("-")) {
      if (parts[i] === "-p" || parts[i] === "--package") i += 2;
      else i += 1;
    }
    return i < parts.length ? { name: parts[i], lookupCommand: "npx" } : undefined;
  }

  // npm exec <tool> → extract tool; other npm subcommands → skip
  if (parts[0] === "npm") {
    if (parts[1] === "exec" && parts.length > 2) return { name: parts[2], lookupCommand: "npm" };
    return undefined;
  }

  // pnpm exec <tool> → wrapper lookup; pnpm dlx <tool> → direct lookup
  if (parts[0] === "pnpm") {
    if (parts[1] === "exec" && parts.length > 2) return { name: parts[2], lookupCommand: "pnpm" };
    if (parts[1] === "dlx" && parts.length > 2) return { name: parts[2], lookupCommand: "pnpm" };
    return undefined;
  }

  // yarn dlx <tool> → direct lookup
  if (parts[0] === "yarn") {
    if (parts[1] === "dlx" && parts.length > 2) return { name: parts[2], lookupCommand: "yarn" };
    return undefined;
  }

  // poetry run <tool> → check poetry existence
  if (parts[0] === "poetry" && parts[1] === "run" && parts.length > 2) {
    return { name: parts[2], lookupCommand: "poetry" };
  }

  return { name: parts[0], lookupCommand: parts[0] };
}

/**
 * Extracts tool references from a HarnessConfig.
 * Collects commands from:
 * 1. enforcement.preCommit and enforcement.postSave (legacy)
 * 2. hooks[] params (commit-test-gate, commit-typecheck-gate, lint-on-save)
 */
export function extractToolNames(config: HarnessConfig): ToolRef[] {
  const seen = new Set<string>();
  const tools: ToolRef[] = [];

  function addCommand(cmd: string, source: string): void {
    const result = extractBinary(cmd);
    if (!result) return;
    if (!seen.has(result.name)) {
      seen.add(result.name);
      tools.push({ name: result.name, lookupCommand: result.lookupCommand, source });
    }
  }

  // Extract from enforcement fields (legacy)
  for (const cmd of config.enforcement.preCommit) {
    addCommand(cmd, "pre-commit");
  }

  for (const ps of config.enforcement.postSave) {
    addCommand(ps.command, "post-save hook");
  }

  // Extract from hooks[] params
  const hookEntries = config.hooks ?? [];
  for (const entry of hookEntries) {
    const params = entry.params as Record<string, unknown>;
    if (entry.block === "commit-test-gate" && typeof params.testCommand === "string") {
      addCommand(params.testCommand, "commit-test-gate hook");
    }
    if (entry.block === "commit-typecheck-gate" && typeof params.typecheckCommand === "string") {
      addCommand(params.typecheckCommand, "commit-typecheck-gate hook");
    }
    if (entry.block === "lint-on-save" && typeof params.command === "string") {
      addCommand(params.command, "lint-on-save hook");
    }
    if (entry.block === "format-on-save" && typeof params.command === "string") {
      addCommand(params.command, "format-on-save hook");
    }
  }

  return tools;
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync("which", [command]);
    return true;
  } catch {
    return false;
  }
}

function getInstallCmd(name: string): string {
  return INSTALL_HINTS[name] ?? `npm install -D ${name}`;
}

export async function checkReferencedTools(config: HarnessConfig): Promise<ToolCheck[]> {
  const refs = extractToolNames(config);
  const results: ToolCheck[] = [];

  for (const ref of refs) {
    const installed = await commandExists(ref.lookupCommand);
    results.push({
      name: ref.name,
      command: ref.name,
      source: ref.source,
      installCmd: getInstallCmd(ref.name),
      installed,
    });
  }

  return results;
}
