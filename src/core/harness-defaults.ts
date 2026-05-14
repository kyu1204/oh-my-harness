import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { HarnessConfig } from "./harness-schema.js";
import { detectProject } from "../detector/project-detector.js";

export interface BuildMinimalConfigOptions {
  presetNames?: string[];
  description?: string;
}

/**
 * Synthesize a schema-conformant minimal HarnessConfig that downstream
 * commands (sync, test, hook add) can operate on.
 *
 * - project.stacks is populated from the deterministic project detector
 *   when possible, falling back to a single stack derived from the first
 *   preset name (so `omh init --preset nextjs` in an empty directory still
 *   yields a stacks-aware yaml).
 * - hooks / enforcement / rules / permissions start empty — they are the
 *   surfaces users grow as they invoke `omh hook add` or hand-edit.
 */
export async function buildMinimalHarnessConfig(
  projectDir: string,
  options: BuildMinimalConfigOptions = {},
): Promise<HarnessConfig> {
  let facts: Awaited<ReturnType<typeof detectProject>> | undefined;
  try {
    facts = await detectProject(projectDir);
  } catch {
    facts = undefined;
  }

  const presetHint = options.presetNames?.find((n) => n && n !== "_base");
  const stackName = presetHint ?? facts?.frameworks[0] ?? "app";
  const framework = facts?.frameworks[0] ?? presetHint ?? "unknown";
  const language = facts?.languages[0] ?? "unknown";
  const packageManager = facts?.packageManagers[0];

  const hasAnyFact =
    !!facts &&
    (facts.languages.length > 0 ||
      facts.frameworks.length > 0 ||
      facts.packageManagers.length > 0);

  const stacks =
    hasAnyFact || presetHint
      ? [
          {
            name: stackName,
            framework,
            language,
            ...(packageManager ? { packageManager } : {}),
          },
        ]
      : [];

  return {
    version: "1.0",
    project: {
      ...(options.description ? { description: options.description } : {}),
      stacks,
    },
    rules: [],
    enforcement: {
      preCommit: [],
      blockedPaths: [],
      blockedCommands: [],
      postSave: [],
    },
    hooks: [],
    permissions: { allow: [], deny: [] },
  };
}

/**
 * Write `harness.yaml` to projectDir, but only if one does not already
 * exist — never clobber a hand-edited config.
 *
 * Returns the absolute path when a file is written (or already existed),
 * and a flag indicating whether a fresh file was created.
 */
export async function ensureHarnessYaml(
  projectDir: string,
  config: HarnessConfig,
): Promise<{ path: string; created: boolean }> {
  const harnessPath = path.join(projectDir, "harness.yaml");
  try {
    await fs.access(harnessPath);
    return { path: harnessPath, created: false };
  } catch {
    // ENOENT — write fresh
  }
  await fs.writeFile(harnessPath, yaml.dump(config, { lineWidth: 120 }), "utf-8");
  return { path: harnessPath, created: true };
}
