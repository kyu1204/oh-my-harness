import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { PresetRegistry } from "../../core/preset-registry.js";
import { mergePresets } from "../../core/config-merger.js";
import { generate } from "../../core/generator.js";
import type { PresetConfig } from "../../core/preset-types.js";
import { parseNaturalLanguage, generateHarnessConfig } from "../../nl/parse-intent.js";
import type { ClaudeRunner } from "../../nl/parse-intent.js";
import { detectProject } from "../../detector/project-detector.js";
import type { ProjectFacts } from "../../detector/project-detector.js";
import { harnessToMergedConfig } from "../../core/harness-converter.js";
import { harnessToMergedConfigV2 } from "../../core/harness-converter-v2.js";
import { createDefaultRegistry } from "../../catalog/registry.js";

export interface InitOptions {
  yes?: boolean;
  projectDir?: string;
  presetsDir?: string;
  preset?: string[];
  nlRunner?: ClaudeRunner;
  _nlDescription?: string;
}

export interface HarnessState {
  presets: string[];
  generatedAt: string;
}

function getDefaultPresetsDir(): string {
  return path.resolve(import.meta.dirname, "../../../presets");
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

export async function loadAndMergePresets(
  presetNames: string[],
  registry: PresetRegistry,
): Promise<PresetConfig[]> {
  const resolved: PresetConfig[] = [];
  const seen = new Set<string>();

  async function resolve(name: string): Promise<void> {
    if (seen.has(name)) return;
    seen.add(name);

    const entry = registry.get(name);
    if (!entry) throw new Error(`Preset not found: ${name}`);

    // Resolve extends chain first
    if (entry.config.extends) {
      for (const dep of entry.config.extends) {
        await resolve(dep);
      }
    }

    resolved.push(entry.config);
  }

  for (const name of presetNames) {
    await resolve(name);
  }

  return resolved;
}

export async function initCommand(
  presetNames: string[],
  options: InitOptions = {},
): Promise<void> {
  const projectDir = options.projectDir ?? process.cwd();
  const presetsDir = options.presetsDir ?? getDefaultPresetsDir();

  // If --preset flag is used, go through preset flow
  if (options.preset && options.preset.length > 0) {
    await initWithPresets(options.preset, projectDir, presetsDir, options);
    return;
  }

  // If preset names are provided as positional args, use legacy flow
  if (presetNames.length > 0) {
    await initWithPresetsLegacy(presetNames, projectDir, presetsDir, options);
    return;
  }

  // If nlRunner provided, use NL flow (test/automation mode)
  if (options.nlRunner) {
    await initWithNL(projectDir, presetsDir, options);
    return;
  }

  // If yes mode with no presets and no NL runner, fall back to _base preset
  if (options.yes) {
    await initWithPresets([], projectDir, presetsDir, options);
    return;
  }

  // Interactive: launch TUI flow
  const { runInitTUI } = await import("../tui/init-flow.js");
  await runInitTUI({ projectDir, presetsDir });
}

/** Headless init for CI/automation — bypasses TUI */
export const initCommandHeadless = initCommand;

async function initWithNL(
  projectDir: string,
  presetsDir: string,
  options: InitOptions,
): Promise<void> {
  let description: string;

  if (options._nlDescription) {
    // Redirected from legacy flow with NL input
    description = options._nlDescription;
  } else if (options.yes && options.nlRunner) {
    // Test/automation mode: use provided runner with a default description
    description = "generate config";
  } else if (!options.yes) {
    const { input } = await import("@inquirer/prompts");
    description = await input({
      message: "Describe your project (e.g., 'Next.js e-commerce app with Stripe'):",
    });
    if (!description.trim()) {
      console.log("No description provided. Use --preset for preset-based init.");
      return;
    }
  } else {
    console.log("No presets specified. Use --preset or provide a description.");
    return;
  }

  console.log(`Generating harness config for: "${description}"`);

  // Detect project facts for richer prompt context
  let facts: ProjectFacts | undefined;
  try {
    facts = await detectProject(projectDir);
  } catch {
    // Non-fatal: continue with no facts
  }

  // Load catalog blocks so LLM knows available building blocks
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

  // Show summary
  const stackNames = harness.project.stacks.map((s) => `${s.name} (${s.framework})`).join(", ");
  console.log(`\nStacks: ${stackNames}`);
  console.log(`Rules: ${harness.rules.length}`);
  const { mergeEnforcementAndHooks } = await import("../../core/harness-converter.js");
  const allHooks = mergeEnforcementAndHooks(harness);
  const hookSummary = allHooks.map((h) => h.block).join(", ") || "none";
  console.log(`Hooks: ${hookSummary}`);

  if (!options.yes) {
    const { confirm } = await import("@inquirer/prompts");
    const ok = await confirm({ message: "Proceed with this configuration?", default: true });
    if (!ok) {
      console.log("Aborted.");
      return;
    }
  }

  // Save harness.yaml first (source of truth)
  const harnessYamlPath = path.join(projectDir, "harness.yaml");
  await fs.writeFile(harnessYamlPath, yaml.dump(harness, { lineWidth: 120 }), "utf-8");

  // Convert to MergedConfig using v2 converter (handles catalog hooks)
  const mergedV2 = await harnessToMergedConfigV2(harness);
  if (mergedV2.catalogErrors && mergedV2.catalogErrors.length > 0) {
    console.log("\nWarnings:");
    for (const err of mergedV2.catalogErrors) {
      console.log(`  ⚠ ${err}`);
    }
  }
  const result = await generate({ projectDir, config: mergedV2 });

  // Save state
  await writeHarnessState(projectDir, {
    presets: ["harness"],
    generatedAt: new Date().toISOString(),
  });

  console.log("\noh-my-harness: initialized successfully (NL mode)");
  console.log("Generated files:");
  for (const f of [...result.files, harnessYamlPath]) {
    console.log(`  ${f}`);
  }
}

async function initWithPresets(
  presetNames: string[],
  projectDir: string,
  presetsDir: string,
  options: InitOptions,
): Promise<void> {
  const registry = new PresetRegistry();
  await registry.discover(presetsDir);

  const names = Array.from(new Set(["_base", ...presetNames]));
  const presetConfigs = await loadAndMergePresets(names, registry);
  const config = mergePresets(presetConfigs);
  const result = await generate({ projectDir, config });

  await writeHarnessState(projectDir, {
    presets: names,
    generatedAt: new Date().toISOString(),
  });

  console.log("\noh-my-harness: initialized successfully");
  console.log(`Presets applied: ${names.join(", ")}`);
  console.log("Generated files:");
  for (const f of result.files) {
    console.log(`  ${f}`);
  }
}

async function initWithPresetsLegacy(
  presetNames: string[],
  projectDir: string,
  presetsDir: string,
  options: InitOptions,
): Promise<void> {
  const registry = new PresetRegistry();
  await registry.discover(presetsDir);

  // Detect if input looks like natural language (contains spaces or unknown preset names)
  const isNaturalLanguage =
    presetNames.length > 0 &&
    presetNames.some((name) => name.includes(" ") || !registry.has(name));

  if (isNaturalLanguage) {
    // Redirect to NL-first flow (generates harness.yaml, not preset selection)
    const description = presetNames.join(" ");
    console.log(`Interpreting as natural language: "${description}"`);

    // Reuse initWithNL by injecting the description
    const nlOptions = { ...options, _nlDescription: description };
    await initWithNL(projectDir, presetsDir, nlOptions);
    return;
  }

  // Direct preset names — use preset flow
  const names = Array.from(new Set(["_base", ...presetNames]));

  const presetConfigs = await loadAndMergePresets(names, registry);
  const config = mergePresets(presetConfigs);
  const result = await generate({ projectDir, config });

  await writeHarnessState(projectDir, {
    presets: names,
    generatedAt: new Date().toISOString(),
  });

  console.log("\noh-my-harness: initialized successfully");
  console.log(`Presets applied: ${names.join(", ")}`);
  console.log("Generated files:");
  for (const f of result.files) {
    console.log(`  ${f}`);
  }
}
