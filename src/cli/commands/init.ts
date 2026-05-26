import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { generate } from "../../core/generator.js";
import { parseNaturalLanguage, generateHarnessConfig } from "../../nl/parse-intent.js";
import type { ClaudeRunner } from "../../nl/parse-intent.js";
import { detectProject } from "../../detector/project-detector.js";
import type { ProjectFacts } from "../../detector/project-detector.js";
import { harnessToMergedConfigV2 } from "../../core/harness-converter-v2.js";
import { createDefaultRegistry } from "../../catalog/registry.js";

export interface InitOptions {
  yes?: boolean;
  projectDir?: string;
  nlRunner?: ClaudeRunner;
}

export interface HarnessState {
  presets: string[];
  generatedAt: string;
}

export async function readHarnessState(projectDir: string): Promise<HarnessState> {
  const stateFile = path.join(projectDir, ".claude", "oh-my-harness.json");
  try {
    const raw = await fs.readFile(stateFile, "utf-8");
    return JSON.parse(raw) as HarnessState;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      throw new Error("oh-my-harness is not initialized. Run `oh-my-harness init` first.");
    }
    throw new Error(`Failed to read harness state: ${error.message}`);
  }
}

export async function writeHarnessState(projectDir: string, state: HarnessState): Promise<void> {
  const claudeDir = path.join(projectDir, ".claude");
  await fs.mkdir(claudeDir, { recursive: true });
  const stateFile = path.join(claudeDir, "oh-my-harness.json");
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

export async function initCommand(
  _presetNames: string[],
  options: InitOptions = {},
): Promise<void> {
  const projectDir = options.projectDir ?? process.cwd();

  if (options.nlRunner) {
    await initWithNL(projectDir, options);
    return;
  }

  if (options.yes) {
    await initWithNL(projectDir, options);
    return;
  }

  const { runInitTUI } = await import("../tui/init-flow.js");
  await runInitTUI({ projectDir });
}

export const initCommandHeadless = initCommand;

export async function initWithNL(
  projectDir: string,
  options: InitOptions,
): Promise<void> {
  let description: string;

  if (options.yes && options.nlRunner) {
    description = "generate config";
  } else if (!options.yes) {
    const { input } = await import("@inquirer/prompts");
    description = await input({
      message: "Describe your project (e.g., 'Next.js e-commerce app with Stripe'):",
    });
    if (!description.trim()) {
      console.log("No description provided.");
      return;
    }
  } else {
    console.log("No description provided.");
    return;
  }

  console.log(`Generating harness config for: "${description}"`);

  let facts: ProjectFacts | undefined;
  try {
    facts = await detectProject(projectDir);
  } catch {
    // Non-fatal
  }

  const registry = await createDefaultRegistry();
  const catalogBlocks = registry.list().map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    event: b.event,
    matcher: b.matcher,
    params: b.params.map((p) => ({ name: p.name, type: p.type, description: p.description, required: p.required, default: p.default })),
  }));

  const harness = await generateHarnessConfig(description, options.nlRunner, catalogBlocks, facts);

  const stackNames = harness.project.stacks.map((s) => `${s.name} (${s.framework})`).join(", ");
  console.log(`\nStacks: ${stackNames}`);
  console.log(`Rules: ${harness.rules.length}`);
  console.log(`Hooks: ${(harness.hooks ?? []).map((h) => h.block).join(", ") || "none"}`);

  if (!options.yes) {
    const { confirm } = await import("@inquirer/prompts");
    const ok = await confirm({ message: "Proceed with this configuration?", default: true });
    if (!ok) {
      console.log("Aborted.");
      return;
    }
  }

  const harnessYamlPath = path.join(projectDir, "harness.yaml");
  await fs.writeFile(harnessYamlPath, yaml.dump(harness, { lineWidth: 120 }), "utf-8");

  const mergedV2 = await harnessToMergedConfigV2(harness);
  if (mergedV2.catalogErrors && mergedV2.catalogErrors.length > 0) {
    console.log("\nWarnings:");
    for (const err of mergedV2.catalogErrors) {
      console.log(`  ⚠ ${err}`);
    }
  }
  const result = await generate({ projectDir, config: mergedV2 });

  await writeHarnessState(projectDir, {
    presets: ["harness"],
    generatedAt: new Date().toISOString(),
  });

  console.log("\noh-my-harness: initialized successfully");
  console.log("Generated files:");
  for (const f of [...result.files, harnessYamlPath]) {
    console.log(`  ${f}`);
  }
}
