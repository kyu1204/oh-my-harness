import { readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { HarnessConfigSchema } from "./harness-schema.js";
import { harnessToMergedConfigV2 } from "./harness-converter-v2.js";
import { planGenerate } from "./generator.js";
import { OMH_MANIFEST } from "../utils/paths.js";
import { OMH_VERSION } from "../utils/version.js";

export interface DriftChange {
  path: string;
  /** "create": file is missing on disk; "update": content differs. */
  kind: "create" | "update";
  /** Content sync would write. */
  planned: string;
  /** Current on-disk content, or null when the file is missing. */
  current: string | null;
}

export interface DriftResult {
  /** True when no files would change and nothing would be deleted. */
  inSync: boolean;
  changed: DriftChange[];
  /** Absolute paths of stale files a sync would remove. */
  wouldDelete: string[];
  /**
   * Set when the manifest records a different oh-my-harness version than the
   * one running now (a cheap "re-sync recommended after upgrade" signal). null
   * when versions match or no manifest exists.
   */
  versionDrift: { manifestVersion: string | null; currentVersion: string } | null;
}

/** Raised when computeDrift is asked to run on a project without a harness.yaml. */
export class HarnessNotFoundError extends Error {
  constructor(public readonly harnessPath: string) {
    super(`harness.yaml not found at ${harnessPath}`);
    this.name = "HarnessNotFoundError";
  }
}

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function readManifestVersion(projectDir: string): Promise<string | null> {
  const raw = await readFileOrNull(join(projectDir, OMH_MANIFEST));
  if (raw === null) return null;
  try {
    const manifest = JSON.parse(raw) as { omhVersion?: unknown };
    return typeof manifest.omhVersion === "string" ? manifest.omhVersion : null;
  } catch {
    return null;
  }
}

/**
 * Compare what a sync would produce against the files currently on disk, without
 * writing anything. Reads harness.yaml, builds the merged config, runs the
 * generator in plan mode, and diffs each planned file against disk.
 */
export async function computeDrift(projectDir: string): Promise<DriftResult> {
  const harnessPath = join(projectDir, "harness.yaml");
  const raw = await readFileOrNull(harnessPath);
  if (raw === null) throw new HarnessNotFoundError(harnessPath);

  const parsed = HarnessConfigSchema.parse(yaml.load(raw));
  const config = await harnessToMergedConfigV2(parsed, undefined, projectDir);
  const plan = await planGenerate({ projectDir, config });

  const changed: DriftChange[] = [];
  for (const file of plan.files) {
    const current = await readFileOrNull(file.path);
    if (current === null) {
      changed.push({ path: file.path, kind: "create", planned: file.content, current: null });
    } else if (current !== file.content) {
      changed.push({ path: file.path, kind: "update", planned: file.content, current });
    }
  }

  const manifestVersion = await readManifestVersion(projectDir);
  const versionDrift =
    manifestVersion !== null && manifestVersion !== OMH_VERSION
      ? { manifestVersion, currentVersion: OMH_VERSION }
      : null;

  const inSync = changed.length === 0 && plan.wouldDelete.length === 0;
  return { inSync, changed, wouldDelete: plan.wouldDelete, versionDrift };
}
