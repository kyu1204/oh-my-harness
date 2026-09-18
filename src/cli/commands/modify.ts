import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import chalk from "chalk";
import { HarnessConfigSchema } from "../../core/harness-schema.js";
import { detectProject } from "../../detector/project-detector.js";
import type { ProjectFacts } from "../../detector/types.js";
import { builtinBlocks } from "../../catalog/blocks/index.js";
import { resolveTypesafeApiKey, TYPESAFE_MODEL } from "../../nl/typesafe-chooser.js";
import { modifyWithJev, applyModifications } from "../../nl/typesafe-modify.js";

// `omh modify "request"` (#118): edit harness.yaml from a sentence. Jev
// decides per block (enable / disable / ask / keep); the command shows the
// change set, confirms, writes, and regenerates through `omh sync`.

export interface ModifyOptions {
  projectDir?: string;
  yes?: boolean;
  dryRun?: boolean;
}

export async function modifyCommand(requestParts: string[], options: ModifyOptions = {}): Promise<{ exitCode: number }> {
  const projectDir = options.projectDir ?? process.cwd();
  const request = requestParts.join(" ").trim();
  if (!request) {
    console.log('Usage: omh modify "what to change" (e.g. "no auto PRs, make the TDD guard ask instead of block")');
    return { exitCode: 1 };
  }

  const apiKey = resolveTypesafeApiKey(projectDir);
  if (!apiKey) {
    console.log("omh modify needs TYPESAFE_API_KEY (environment or the project's .env): Jev decides which blocks the request refers to.");
    console.log("Without it, edit harness.yaml directly and run `omh sync`.");
    return { exitCode: 1 };
  }

  const harnessPath = path.join(projectDir, "harness.yaml");
  let harness;
  try {
    const parsed = HarnessConfigSchema.safeParse(yaml.load(await fs.readFile(harnessPath, "utf-8")));
    if (!parsed.success) {
      console.log(`harness.yaml does not validate: ${parsed.error.message}`);
      return { exitCode: 1 };
    }
    harness = parsed.data;
  } catch {
    console.log("No harness.yaml here. Run `omh init` first.");
    return { exitCode: 1 };
  }

  let facts: ProjectFacts | undefined;
  try { facts = await detectProject(projectDir); } catch { /* non-fatal */ }

  let result;
  try {
    result = await modifyWithJev({ request, harness, blocks: builtinBlocks }, { apiKey });
  } catch (err) {
    console.log(`TypeSafe chooser unavailable (${(err as Error).message}). Edit harness.yaml directly and run \`omh sync\`.`);
    return { exitCode: 1 };
  }

  const applied = applyModifications(harness, result.decisions, facts, builtinBlocks);
  console.log(chalk.dim(`Jev (${TYPESAFE_MODEL}) read the request, ${result.usage?.input_tokens ?? "?"} input tokens`));
  for (const r of applied.refused) console.log(`  ${chalk.yellow("refused")}  ${r.reason}`);
  if (applied.changes.length === 0) {
    console.log("No changes: Jev did not match the request to any block with enough confidence. Try naming the block or the behaviour.");
    return { exitCode: 0 };
  }
  for (const c of applied.changes) {
    const verb = c.action === "enable" ? chalk.green("enable ") : c.action === "disable" ? chalk.red("disable") : chalk.yellow("ask    ");
    console.log(`  ${verb}  ${c.block}`);
  }
  if (options.dryRun) {
    console.log(chalk.dim("dry run: harness.yaml not written"));
    return { exitCode: 0 };
  }
  if (!options.yes) {
    const { confirm } = await import("@inquirer/prompts");
    if (!(await confirm({ message: "Apply these changes to harness.yaml and re-sync?", default: true }))) {
      console.log("Aborted.");
      return { exitCode: 0 };
    }
  }
  await fs.writeFile(harnessPath, yaml.dump(applied.harness, { lineWidth: 120 }), "utf-8");
  const { syncCommand } = await import("./sync.js");
  const sync = await syncCommand({ projectDir });
  return { exitCode: sync.exitCode };
}
