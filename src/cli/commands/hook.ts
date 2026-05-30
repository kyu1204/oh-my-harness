import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { createDefaultRegistry } from "../../catalog/registry.js";
import type { HookEntry, ParamDefinition } from "../../catalog/types.js";
import { syncCommand } from "./sync.js";
import { buildMinimalHarnessConfig } from "../../core/harness-defaults.js";

export interface HookAddOptions {
  yes?: boolean;
  projectDir?: string;
}

export interface HookRemoveOptions {
  projectDir?: string;
}

interface HarnessYamlWithHooks {
  hooks?: HookEntry[];
  [key: string]: unknown;
}

async function readHarnessYaml(projectDir: string): Promise<HarnessYamlWithHooks> {
  const harnessYamlPath = path.join(projectDir, "harness.yaml");
  try {
    const raw = await fs.readFile(harnessYamlPath, "utf-8");
    return (yaml.load(raw) as HarnessYamlWithHooks) ?? {};
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      // Bootstrap a schema-conformant skeleton on first use so that
      // `omh hook add` works before the user has run `omh init`.
      // stacks are populated from the deterministic project detector so the
      // generated yaml is informative rather than empty.
      const minimal = await buildMinimalHarnessConfig(projectDir);
      return minimal as unknown as HarnessYamlWithHooks;
    }
    throw error;
  }
}

async function writeHarnessYaml(projectDir: string, data: HarnessYamlWithHooks): Promise<void> {
  const harnessYamlPath = path.join(projectDir, "harness.yaml");
  await fs.writeFile(harnessYamlPath, yaml.dump(data, { lineWidth: 120 }), "utf-8");
}

async function promptForParams(
  params: ParamDefinition[],
  yes: boolean,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};

  for (const param of params) {
    // Use default if --yes flag or no interactivity needed
    if (yes && param.default !== undefined) {
      result[param.name] = param.default;
      continue;
    }

    if (param.type === "boolean") {
      const defaultVal = typeof param.default === "boolean" ? param.default : false;
      const value = await clack.confirm({
        message: `${param.name}: ${param.description}`,
        initialValue: defaultVal,
      });
      if (clack.isCancel(value)) {
        console.log(chalk.yellow("Cancelled."));
        process.exit(0);
      }
      result[param.name] = value;
    } else if (param.type === "string[]") {
      const defaultVal = Array.isArray(param.default) ? (param.default as string[]).join(", ") : "";
      const value = await clack.text({
        message: `${param.name}: ${param.description} (comma-separated)`,
        placeholder: defaultVal || "(empty)",
        defaultValue: defaultVal,
      });
      if (clack.isCancel(value)) {
        console.log(chalk.yellow("Cancelled."));
        process.exit(0);
      }
      result[param.name] = (value as string)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      const defaultVal = param.default !== undefined ? String(param.default) : "";
      const value = await clack.text({
        message: `${param.name}: ${param.description}`,
        placeholder: defaultVal || "(empty)",
        defaultValue: defaultVal,
      });
      if (clack.isCancel(value)) {
        console.log(chalk.yellow("Cancelled."));
        process.exit(0);
      }
      result[param.name] = value as string;
    }
  }

  return result;
}

export async function hookAddCommand(
  blockId: string,
  options: HookAddOptions = {},
): Promise<void> {
  const projectDir = options.projectDir ?? process.cwd();
  const registry = await createDefaultRegistry();
  const block = registry.get(blockId);

  if (!block) {
    console.error(chalk.red(`Block not found: ${blockId}`));
    console.error("Run `oh-my-harness catalog list` to see available blocks.");
    process.exit(1);
  }

  console.log(chalk.bold(`Adding: ${block.name}`));
  console.log(chalk.dim(block.description));

  const params = await promptForParams(block.params, options.yes ?? false);

  const harness = await readHarnessYaml(projectDir);
  if (!harness.hooks) harness.hooks = [];

  // Avoid duplicates
  const existing = harness.hooks.findIndex((h) => h.block === blockId);
  if (existing !== -1) {
    harness.hooks[existing] = { block: blockId, params };
    console.log(chalk.yellow(`Updated existing hook: ${blockId}`));
  } else {
    harness.hooks.push({ block: blockId, params });
    console.log(chalk.green(`Added hook: ${blockId}`));
  }

  await writeHarnessYaml(projectDir, harness);
  await syncCommand({ projectDir });
}

export async function hookRemoveCommand(
  blockId: string,
  options: HookRemoveOptions = {},
): Promise<void> {
  const projectDir = options.projectDir ?? process.cwd();
  const harness = await readHarnessYaml(projectDir);

  if (!harness.hooks || harness.hooks.length === 0) {
    console.error(chalk.yellow("No hooks configured in harness.yaml"));
    return;
  }

  const before = harness.hooks.length;
  harness.hooks = harness.hooks.filter((h) => h.block !== blockId);

  if (harness.hooks.length === before) {
    console.error(chalk.yellow(`Hook not found: ${blockId}`));
    return;
  }

  await writeHarnessYaml(projectDir, harness);
  console.log(chalk.green(`Removed hook: ${blockId}`));
  await syncCommand({ projectDir });
}
