import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import chalk from "chalk";
import { HarnessConfigSchema } from "../../core/harness-schema.js";
import { harnessToMergedConfigV2 } from "../../core/harness-converter-v2.js";
import { generate } from "../../core/generator.js";

export interface SyncOptions {
  projectDir?: string;
}

export async function syncCommand(options: SyncOptions = {}): Promise<void> {
  const projectDir = options.projectDir ?? process.cwd();
  const harnessYamlPath = path.join(projectDir, "harness.yaml");

  let raw: string | undefined;
  try {
    raw = await fs.readFile(harnessYamlPath, "utf-8");
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      console.error(chalk.red(`harness.yaml not found at ${harnessYamlPath}`));
      console.error("Run `oh-my-harness init` to create one.");
    } else {
      console.error(chalk.red(`Failed to read harness.yaml: ${error.message}`));
    }
    process.exit(1);
    return;
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    const error = err as Error;
    console.error(chalk.red(`Failed to parse harness.yaml: ${error.message}`));
    process.exit(1);
    return;
  }

  const result = HarnessConfigSchema.safeParse(parsed);
  if (!result.success) {
    console.error(chalk.red("harness.yaml validation failed:"));
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
    return;
  }

  const harness = result.data;
  const mergedV2 = await harnessToMergedConfigV2(harness, undefined, projectDir);
  if (mergedV2.catalogErrors && mergedV2.catalogErrors.length > 0) {
    for (const err of mergedV2.catalogErrors) {
      console.log(chalk.yellow(`  ⚠ ${err}`));
    }
  }
  const genResult = await generate({ projectDir, config: mergedV2 });

  console.log(chalk.green("oh-my-harness: sync complete"));
  console.log("Generated files:");
  for (const f of genResult.files) {
    console.log(`  ${f}`);
  }
}
