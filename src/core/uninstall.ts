import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse, stringify } from "smol-toml";
import { extractManagedSections, removeManagedSection } from "../utils/markdown.js";
import { isOmhHookCommand } from "./managed-hooks.js";

export interface ComputeUninstallOptions {
  projectDir: string;
  purge?: boolean;
}

export interface UninstallPlan {
  delete: string[];
  modify: Array<{ path: string; content: string; backupPath?: string }>;
  removeDirs: string[];
  keptHarnessYaml: boolean;
  warnings: string[];
  destructiveWarnings: string[];
}

export interface UninstallResult {
  modified: string[];
  deleted: string[];
  removedDirs: string[];
  restored: string[];
  failed: Array<{ path: string; op: "modify" | "delete" | "removeDir" | "restore"; message: string }>;
  warnings: string[];
}

export interface ApplyUninstallOptions {
  continueOnError?: boolean;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function nullIfEmptyObject(value: Record<string, unknown>): Record<string, unknown> | null {
  return Object.keys(value).length === 0 ? null : value;
}

export function stripManagedMarkdown(content: string): string | null {
  let stripped = content;
  for (const { id } of extractManagedSections(content)) {
    stripped = removeManagedSection(stripped, id);
  }
  stripped = stripped.replace(/^\n+/, "").replace(/[ \t]+\n/g, "\n");
  if (stripped.trim() === "") return null;
  return stripped.endsWith("\n") ? stripped : `${stripped}\n`;
}

async function stripHookEntries(existingHooks: unknown, projectDir: string): Promise<Record<string, unknown[]> | undefined> {
  if (!isPlainObject(existingHooks)) return undefined;
  const result: Record<string, unknown[]> = {};

  for (const [event, entries] of Object.entries(existingHooks)) {
    const eventEntries = Array.isArray(entries) ? entries : [entries];
    for (const entry of eventEntries) {
      if (!isPlainObject(entry) || !Array.isArray(entry.hooks)) {
        if (!result[event]) result[event] = [];
        result[event].push(entry);
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
        if (!result[event]) result[event] = [];
        result[event].push({ ...entry, hooks: userHooks });
      }
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export async function stripClaudeSettings(
  settings: Record<string, unknown>,
  projectDir: string,
): Promise<Record<string, unknown> | null> {
  const result: Record<string, unknown> = { ...settings };
  const meta = isPlainObject(settings._ohMyHarness) ? settings._ohMyHarness : {};
  const managedPermissions = isPlainObject(meta.managedPermissions) ? meta.managedPermissions : {};
  const managedAllow = new Set(asStringArray(managedPermissions.allow));
  const managedDeny = new Set(asStringArray(managedPermissions.deny));

  if (isPlainObject(settings.permissions)) {
    const permissions: Record<string, unknown> = { ...settings.permissions };
    const allow = asStringArray(permissions.allow).filter((item) => !managedAllow.has(item));
    const deny = asStringArray(permissions.deny).filter((item) => !managedDeny.has(item));
    if (allow.length > 0) permissions.allow = allow;
    else delete permissions.allow;
    if (deny.length > 0) permissions.deny = deny;
    else delete permissions.deny;

    if (Object.keys(permissions).length > 0) result.permissions = permissions;
    else delete result.permissions;
  }

  const hooks = await stripHookEntries(settings.hooks, projectDir);
  if (hooks) result.hooks = hooks;
  else delete result.hooks;

  delete result._ohMyHarness;
  return nullIfEmptyObject(result);
}

export function stripCodexConfigToml(content: string): { content: string | null; warnings: string[] } {
  const warnings = [
    ".codex/config.toml: [features].hooks/goals 제거 예정. 사용자가 직접 설정한 값이면 복원이 필요할 수 있습니다.",
    ".codex/config.toml: 수정 시 TOML in-file comments가 제거될 수 있습니다.",
  ];
  if (!content.trim()) return { content: null, warnings: [] };

  const data = parse(content) as Record<string, unknown>;
  let deletedAny = false;
  if (isPlainObject(data.features)) {
    for (const key of ["hooks", "goals", "codex_hooks"]) {
      if (Object.prototype.hasOwnProperty.call(data.features, key)) {
        delete data.features[key];
        deletedAny = true;
      }
    }
    if (!deletedAny) return { content, warnings: [] };
    if (Object.keys(data.features).length === 0) delete data.features;
  }

  if (!deletedAny) return { content, warnings: [] };
  if (Object.keys(data).length === 0) return { content: null, warnings };
  return { content: `${stringify(data)}\n`, warnings };
}

export async function stripCodexHooksJson(
  hooksJson: Record<string, unknown>,
  projectDir: string,
): Promise<Record<string, unknown> | null> {
  const hooks = await stripHookEntries(hooksJson.hooks, projectDir);
  if (!hooks) return null;
  return { ...hooksJson, hooks };
}

export function stripGitignoreSection(content: string): string | null {
  const lines = content.split("\n").map((line) => line.replace(/\r$/, ""));
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "# oh-my-harness") {
      i++;
      while (i < lines.length && lines[i].trim() !== "") i++;
      continue;
    }
    out.push(lines[i]);
  }
  const stripped = out.join("\n").replace(/\n{3,}/g, "\n\n");
  return stripped.trim() === "" ? null : (stripped.endsWith("\n") ? stripped : `${stripped}\n`);
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") return null;
    throw err;
  }
}

async function planTextMutation(
  plan: UninstallPlan,
  filePath: string,
  nextContent: string | null,
): Promise<void> {
  if (!await exists(filePath)) return;
  if (nextContent === null) plan.delete.push(filePath);
  else plan.modify.push({ path: filePath, content: nextContent });
}

export async function computeUninstall(options: ComputeUninstallOptions): Promise<UninstallPlan> {
  const { projectDir, purge = false } = options;
  const plan: UninstallPlan = {
    delete: [],
    modify: [],
    removeDirs: [],
    keptHarnessYaml: !purge,
    warnings: [],
    destructiveWarnings: ["백업 후 실행 권장: uninstall은 파일을 수정/삭제하는 파괴적 작업입니다."],
  };

  for (const target of [
    path.join(projectDir, ".omh"),
    path.join(projectDir, ".claude", "oh-my-harness.json"),
    path.join(projectDir, ".pi", "extensions", "omh-harness.ts"),
    path.join(projectDir, ".claude", "skills", "omh-loop"),
  ]) {
    if (await exists(target)) plan.delete.push(target);
  }

  if (purge && await exists(path.join(projectDir, "harness.yaml"))) {
    plan.delete.push(path.join(projectDir, "harness.yaml"));
    plan.keptHarnessYaml = false;
  }

  for (const markdownPath of [path.join(projectDir, "CLAUDE.md"), path.join(projectDir, "AGENTS.md")]) {
    const content = await readTextIfExists(markdownPath);
    if (content !== null) await planTextMutation(plan, markdownPath, stripManagedMarkdown(content));
  }

  const settingsPath = path.join(projectDir, ".claude", "settings.json");
  const settingsRaw = await readTextIfExists(settingsPath);
  if (settingsRaw !== null) {
    const stripped = await stripClaudeSettings(JSON.parse(settingsRaw) as Record<string, unknown>, projectDir);
    await planTextMutation(plan, settingsPath, stripped ? `${JSON.stringify(stripped, null, 2)}\n` : null);
  }

  const codexHooksPath = path.join(projectDir, ".codex", "hooks.json");
  const codexHooksRaw = await readTextIfExists(codexHooksPath);
  if (codexHooksRaw !== null) {
    const stripped = await stripCodexHooksJson(JSON.parse(codexHooksRaw) as Record<string, unknown>, projectDir);
    await planTextMutation(plan, codexHooksPath, stripped ? `${JSON.stringify(stripped, null, 2)}\n` : null);
  }

  const codexTomlPath = path.join(projectDir, ".codex", "config.toml");
  const codexTomlRaw = await readTextIfExists(codexTomlPath);
  if (codexTomlRaw !== null) {
    const stripped = stripCodexConfigToml(codexTomlRaw);
    plan.warnings.push(...stripped.warnings);
    plan.destructiveWarnings.push(...stripped.warnings);
    await planTextMutation(plan, codexTomlPath, stripped.content);
  }

  const gitignorePath = path.join(projectDir, ".gitignore");
  const gitignoreRaw = await readTextIfExists(gitignorePath);
  if (gitignoreRaw !== null) await planTextMutation(plan, gitignorePath, stripGitignoreSection(gitignoreRaw));

  plan.removeDirs.push(
    path.join(projectDir, ".pi", "extensions"),
    path.join(projectDir, ".pi"),
    path.join(projectDir, ".codex"),
    path.join(projectDir, ".claude"),
  );

  return plan;
}

async function restoreBackups(backups: Map<string, string>, result: UninstallResult): Promise<void> {
  for (const [target, backup] of backups) {
    try {
      await fs.copyFile(backup, target);
      result.restored.push(target);
    } catch (err) {
      result.failed.push({ path: target, op: "restore", message: (err as Error).message });
    }
  }
}

export async function applyUninstallPlan(
  plan: UninstallPlan,
  options: ApplyUninstallOptions = {},
): Promise<UninstallResult> {
  const result: UninstallResult = {
    modified: [],
    deleted: [],
    removedDirs: [],
    restored: [],
    failed: [],
    warnings: [...plan.warnings],
  };
  const backups = new Map<string, string>();
  const backupDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-uninstall-backup-"));

  const recordFailure = async (
    pathName: string,
    op: "modify" | "delete" | "removeDir",
    err: unknown,
  ): Promise<boolean> => {
    result.failed.push({ path: pathName, op, message: (err as Error).message });
    if (!options.continueOnError) {
      await restoreBackups(backups, result);
      return false;
    }
    return true;
  };

  try {
    for (const item of plan.modify) {
      try {
        const backup = path.join(backupDir, `${backups.size}.bak`);
        await fs.copyFile(item.path, backup);
        backups.set(item.path, backup);
        await fs.writeFile(item.path, item.content, "utf8");
        result.modified.push(item.path);
      } catch (err) {
        if (!await recordFailure(item.path, "modify", err)) return result;
      }
    }

    for (const target of plan.delete) {
      try {
        await fs.rm(target, { recursive: true, force: false });
        result.deleted.push(target);
      } catch (err) {
        if (!await recordFailure(target, "delete", err)) return result;
      }
    }

    for (const dir of plan.removeDirs) {
      try {
        await fs.rmdir(dir);
        result.removedDirs.push(dir);
      } catch (err) {
        if (isErrnoException(err) && (err.code === "ENOENT" || err.code === "ENOTEMPTY")) continue;
        if (!await recordFailure(dir, "removeDir", err)) return result;
      }
    }

    return result;
  } finally {
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
