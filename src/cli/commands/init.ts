import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { generate } from "../../core/generator.js";
import { generateHarnessConfig, providerConfigFromEnv } from "../../nl/parse-intent.js";
import type { ClaudeRunner } from "../../nl/parse-intent.js";
import { hasProviderConfig } from "../../nl/config-store.js";
import { buildPresetHarness, isPresetName, PRESET_NAMES, type PresetName } from "../../core/presets.js";
import { chooseWithJev, harnessFromChoices, resolveTypesafeApiKey, TYPESAFE_MODEL } from "../../nl/typesafe-chooser.js";
import type { HarnessConfig } from "../../core/harness-schema.js";
import { detectProject } from "../../detector/project-detector.js";
import type { ProjectFacts } from "../../detector/project-detector.js";
import { harnessToMergedConfigV2 } from "../../core/harness-converter-v2.js";
import { createDefaultRegistry } from "../../catalog/registry.js";
import { buildMinimalHarnessConfig, ensureHarnessYaml } from "../../core/harness-defaults.js";

export interface InitOptions {
  yes?: boolean;
  projectDir?: string;
  nlRunner?: ClaudeRunner;
  description?: string;
  /** Deterministic preset (#116): minimal | safe | strict. No provider, no network. */
  preset?: string;
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
  descriptionParts: string[],
  options: InitOptions = {},
): Promise<void> {
  const projectDir = options.projectDir ?? process.cwd();
  const inlineDescription = descriptionParts.join(" ").trim();
  if (inlineDescription) {
    options = { ...options, description: inlineDescription };
  }

  // Anything that already says what to build skips the TUI; initWithNL still
  // asks "Proceed?" unless -y was given.
  if (options.nlRunner || options.yes || options.preset || options.description) {
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
  if (options.preset !== undefined && !isPresetName(options.preset)) {
    throw new Error(`Unknown preset "${options.preset}". Valid presets: ${PRESET_NAMES.join(", ")}`);
  }
  const preset = options.preset as PresetName | undefined;

  let description = options.description?.trim() ?? "";
  if (!description && options.nlRunner) description = "generate config";
  if (!description && !preset) {
    if (options.yes) {
      console.log("No description provided.");
      return;
    }
    const { input } = await import("@inquirer/prompts");
    description = (await input({
      message: "Describe your project (e.g., 'Next.js e-commerce app with Stripe'):",
    })).trim();
    if (!description) {
      console.log("No description provided.");
      return;
    }
  }

  if (description) console.log(`Generating harness config for: "${description}"`);

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

  // Which generator? --preset always wins and stays offline and deterministic;
  // then an injected LLM runner (tests); then Jev when a TYPESAFE_API_KEY is
  // around and there is a description to judge; then a configured LLM
  // provider; and with none of those, the "safe" preset with a hint instead
  // of a provider-setup error (#116, #129).
  const typesafeKey = resolveTypesafeApiKey(projectDir);
  const registryBlocks = registry.list();
  let harness: HarnessConfig;
  if (preset) {
    harness = buildPresetHarness(preset, facts, { description: description || undefined });
    console.log(`preset: ${preset}`);
  } else if (options.nlRunner) {
    harness = await generateHarnessConfig(description, options.nlRunner, catalogBlocks, facts);
  } else if (typesafeKey && description) {
    try {
      const result = await chooseWithJev({ description, facts, blocks: registryBlocks }, { apiKey: typesafeKey });
      const applied = harnessFromChoices(result, facts, { description });
      const on = [...result.blocks].filter(([, v]) => v === "on").map(([k]) => k);
      const off = [...result.blocks].filter(([, v]) => v === "off").map(([k]) => k);
      const undecided = [...result.blocks].filter(([, v]) => v === "undecided").map(([k]) => k);
      console.log(`Jev (${TYPESAFE_MODEL}) chose: strictness=${result.strictness}, ${result.usage?.input_tokens ?? "?"} input tokens`);
      console.log(`  enabled:   ${on.join(", ") || "none"}`);
      console.log(`  disabled:  ${off.join(", ") || "none"}`);
      if (undecided.length) console.log(`  undecided: ${undecided.join(", ")} (kept as the preset has them)`);
      for (const s of applied.skipped) console.log(`  skipped:   ${s.reason}`);
      const { skipped: _skipped, ...rest } = applied;
      harness = rest;
    } catch (err) {
      console.log(`TypeSafe chooser unavailable (${(err as Error).message}); using the "safe" preset instead.`);
      harness = buildPresetHarness("safe", facts, { description });
    }
  } else if ((await hasProviderConfig()) || providerConfigFromEnv()) {
    harness = await generateHarnessConfig(description, options.nlRunner, catalogBlocks, facts);
  } else {
    harness = buildPresetHarness("safe", facts, { description });
    console.log('No AI provider and no TYPESAFE_API_KEY found; using the "safe" preset.');
    console.log(`  Pick one explicitly with --preset ${PRESET_NAMES.join("|")}, set TYPESAFE_API_KEY to let Jev tune it, or run \`omh config\` for an LLM provider.`);
  }

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
