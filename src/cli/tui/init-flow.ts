import * as p from "@clack/prompts";
import chalk from "chalk";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { checkDependencies } from "../deps-checker.js";
import type { DepCheck } from "../deps-checker.js";
import { checkReferencedTools } from "../tool-checker.js";
import type { ToolCheck } from "../tool-checker.js";
import { PresetRegistry } from "../../core/preset-registry.js";
import { loadAndMergePresets, writeHarnessState } from "../commands/init.js";
import { mergePresets } from "../../core/config-merger.js";
import { generate } from "../../core/generator.js";
import { generateHarnessConfig } from "../../nl/parse-intent.js";
import { mergeEnforcementAndHooks } from "../../core/harness-converter.js";
import type { HarnessConfig } from "../../core/harness-schema.js";
import { HarnessConfigSchema } from "../../core/harness-schema.js";
import { detectProject } from "../../detector/project-detector.js";
import type { ProjectFacts } from "../../detector/types.js";

function getDefaultPresetsDir(): string {
  return path.resolve(import.meta.dirname, "../../../presets");
}

export function formatDepResults(deps: DepCheck[]): string {
  if (deps.length === 0) return "";

  const lines: string[] = [];
  for (const dep of deps) {
    if (dep.installed) {
      const version = dep.version ? ` (${dep.version})` : "";
      lines.push(`  ${chalk.green("\u2713")} ${dep.name}${chalk.dim(version)}`);
    } else if (dep.required) {
      lines.push(`  ${chalk.red("\u2717")} ${dep.name} ${chalk.red("missing")} \u2014 ${dep.installHint}`);
    } else {
      lines.push(`  ${chalk.yellow("\u25CB")} ${dep.name} ${chalk.yellow("optional")} \u2014 ${dep.installHint}`);
    }
  }
  return lines.join("\n");
}

export function formatConfigSummary(config: HarnessConfig): string {
  const lines: string[] = [];

  // Project info
  if (config.project.name) {
    lines.push(`  Project: ${chalk.cyan(config.project.name)}`);
  }
  const stackSummary = config.project.stacks
    .map((s) => `${s.name} (${s.framework}/${s.language})`)
    .join(", ");
  if (stackSummary) {
    lines.push(`  Stack: ${stackSummary}`);
  }

  // Rules
  if (config.rules.length > 0) {
    lines.push("");
    lines.push("  Rules:");
    for (let i = 0; i < config.rules.length; i++) {
      const rule = config.rules[i];
      lines.push(`    ${i + 1}. ${rule.title} (priority: ${rule.priority})`);
    }
  }

  // Hooks (merged from enforcement + explicit hooks)
  const allHooks = mergeEnforcementAndHooks(config);
  if (allHooks.length > 0) {
    lines.push("");
    lines.push("  Hooks:");
    for (const hook of allHooks) {
      const paramSummary = Object.entries(hook.params)
        .map(([k, v]) => `${k}=${Array.isArray(v) ? (v as string[]).join(",") : String(v)}`)
        .join(", ");
      lines.push(`    ${hook.block}${paramSummary ? ` (${paramSummary})` : ""}`);
    }
  }

  return lines.join("\n");
}

export function formatProjectFacts(facts: ProjectFacts): string {
  const lines: string[] = [];
  const entries: Array<[string, string[]]> = [
    ["Languages", facts.languages],
    ["Frameworks", facts.frameworks],
    ["Package managers", facts.packageManagers],
    ["Test commands", facts.testCommands],
    ["Lint commands", facts.lintCommands],
    ["Build commands", facts.buildCommands],
    ["Typecheck", facts.typecheckCommands],
    ["Blocked paths", facts.blockedPaths],
  ];

  for (const [label, values] of entries) {
    if (values.length > 0) {
      lines.push(`  ${chalk.bold(label)}: ${values.join(", ")}`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : `  ${chalk.dim("No project signals detected")}`;
}

function handleCancel(value: unknown): void {
  if (p.isCancel(value)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }
}

export async function runInitTUI(options?: {
  projectDir?: string;
  presetsDir?: string;
}): Promise<void> {
  const projectDir = options?.projectDir ?? process.cwd();
  const presetsDir = options?.presetsDir ?? getDefaultPresetsDir();

  // Step 1: Welcome Banner
  p.intro(
    `${chalk.bgCyan(chalk.black(" oh-my-harness "))} ${chalk.dim("Tame your AI coding agents")}`,
  );

  // Step 2: Dependency Check
  const depSpinner = p.spinner();
  depSpinner.start("Checking dependencies...");

  const deps = await checkDependencies();
  depSpinner.stop("Dependencies checked");

  const depOutput = formatDepResults(deps);
  p.note(depOutput, "System Dependencies");

  const missingRequired = deps.filter((d) => d.required && !d.installed);
  const claudeInstalled = deps.find((d) => d.name === "claude")?.installed ?? false;

  if (missingRequired.length > 0) {
    p.log.error(
      `Missing required dependencies: ${missingRequired.map((d) => d.name).join(", ")}`,
    );
    const continueAnyway = await p.confirm({
      message: "Continue anyway? (some features may not work)",
      initialValue: false,
    });
    handleCancel(continueAnyway);
    if (!continueAnyway) {
      p.cancel("Install missing dependencies and try again.");
      process.exit(1);
    }
  }

  if (!claudeInstalled) {
    p.log.warn("claude CLI not installed. AI-powered mode will not be available.");
  }

  // Step 2.5: Project Detection
  const detectSpinner = p.spinner();
  detectSpinner.start("Detecting project type...");

  let projectFacts: ProjectFacts | undefined;
  try {
    const facts = await detectProject(projectDir);
    const hasAnyFacts = facts.languages.length > 0 || facts.frameworks.length > 0;
    if (hasAnyFacts) {
      projectFacts = facts;
    }
    detectSpinner.stop("Project detected");
  } catch {
    detectSpinner.stop("Project detection skipped");
  }

  if (projectFacts) {
    p.note(formatProjectFacts(projectFacts), "Detected Project");
  }

  // Step 3: Mode Selection
  type ModeValue = "nl" | "preset" | "import";
  const modeOptions: Array<{ value: ModeValue; label: string; hint?: string }> = [];

  if (claudeInstalled) {
    modeOptions.push({
      value: "nl",
      label: "Describe your project (AI-powered)",
    });
  } else {
    modeOptions.push({
      value: "nl",
      label: "Describe your project (AI-powered)",
      hint: "requires claude CLI",
    });
  }

  modeOptions.push({
    value: "preset",
    label: "Choose from presets",
  });

  modeOptions.push({
    value: "import",
    label: "Import existing harness.yaml",
  });

  const mode = await p.select({
    message: "How would you like to configure your harness?",
    options: modeOptions,
  });

  handleCancel(mode);

  if (mode === "nl" && !claudeInstalled) {
    p.log.error("claude CLI is required for AI-powered mode. Install it with:");
    p.log.info("  npm install -g @anthropic-ai/claude-code");
    p.cancel("Cannot proceed without claude CLI.");
    process.exit(1);
  }

  let harnessConfig: HarnessConfig | undefined;
  let presetNames: string[] | undefined;

  if (mode === "nl") {
    // Step 4a: NL Mode
    const description = await p.text({
      message: "Describe your project:",
      placeholder: "e.g., Next.js e-commerce app with Stripe and Tailwind",
      validate: (value) => {
        if (!value || !value.trim()) return "Please enter a project description";
      },
    });
    handleCancel(description);

    const genSpinner = p.spinner();
    genSpinner.start("Generating harness configuration...");

    try {
      // Load catalog blocks so LLM knows available building blocks + validation
      const { createDefaultRegistry } = await import("../../catalog/registry.js");
      const catalogRegistry = await createDefaultRegistry();
      const catalogBlocks = catalogRegistry.list().map((b) => ({
        id: b.id,
        description: b.description,
        params: b.params.map((pp) => ({ name: pp.name, required: pp.required, default: pp.default, description: pp.description })),
      }));
      harnessConfig = await generateHarnessConfig(description as string, undefined, catalogBlocks, projectFacts);
      genSpinner.stop("Configuration generated");
    } catch (err) {
      genSpinner.stop("Generation failed");
      p.log.error(`Failed to generate config: ${(err as Error).message}`);
      p.cancel("Try again or use preset mode.");
      process.exit(1);
    }

    // Show summary
    const summary = formatConfigSummary(harnessConfig);
    p.note(summary, "Generated Configuration");

    const confirmed = await p.confirm({
      message: "Proceed with this configuration?",
      initialValue: true,
    });
    handleCancel(confirmed);
    if (!confirmed) {
      p.cancel("Aborted.");
      process.exit(0);
    }
  } else if (mode === "preset") {
    // Step 4b: Preset Mode
    const registry = new PresetRegistry();
    await registry.discover(presetsDir);

    const allPresets = registry.list().filter((e) => e.name !== "_base");

    if (allPresets.length === 0) {
      p.log.warn("No presets found (besides _base).");
      presetNames = ["_base"];
    } else {
      p.log.info(`${chalk.dim("_base preset is always included automatically.")}`);

      const selected = await p.multiselect({
        message: "Select presets to apply:",
        options: allPresets.map((entry) => ({
          value: entry.name,
          label: entry.config.displayName,
          hint: entry.config.description,
        })),
        required: true,
      });
      handleCancel(selected);
      presetNames = ["_base", ...(selected as string[])];
    }
  } else if (mode === "import") {
    // Step 4c: Import Mode
    const importPath = await p.text({
      message: "Path to harness.yaml:",
      placeholder: "./harness.yaml",
      validate: (value) => {
        if (!value || !value.trim()) return "Please enter a file path";
      },
    });
    handleCancel(importPath);

    const resolvedPath = path.resolve(projectDir, importPath as string);
    try {
      const raw = await fs.readFile(resolvedPath, "utf-8");
      const parsed = yaml.load(raw);
      const result = HarnessConfigSchema.safeParse(parsed);
      if (!result.success) {
        p.log.error(`Invalid harness.yaml: ${result.error.message}`);
        p.cancel("Fix the file and try again.");
        process.exit(1);
      }
      harnessConfig = result.data;
      p.log.success("Imported harness.yaml successfully");

      const summary = formatConfigSummary(harnessConfig);
      p.note(summary, "Imported Configuration");
    } catch (err) {
      p.log.error(`Failed to read file: ${(err as Error).message}`);
      p.cancel("Check the file path and try again.");
      process.exit(1);
    }
  }

  // Step 5: Missing Package Check
  if (harnessConfig) {
    const toolResults = await checkReferencedTools(harnessConfig);
    const missingTools = toolResults.filter((t) => !t.installed);

    if (missingTools.length > 0) {
      const toolLines = missingTools
        .map(
          (t) =>
            `  ${chalk.yellow("\u26A0")} ${chalk.bold(t.name)} \u2014 Used in ${t.source}\n    ${chalk.dim("\u2192")} ${t.installCmd}`,
        )
        .join("\n");

      p.note(toolLines, "Missing Tools");

      const installChoice = await p.select({
        message: "Install missing packages?",
        options: [
          { value: "all", label: "Yes, install all" },
          { value: "skip", label: "Skip for now" },
          { value: "choose", label: "Let me choose which to install" },
        ],
      });
      handleCancel(installChoice);

      if (installChoice === "all") {
        for (const tool of missingTools) {
          const installSpinner = p.spinner();
          installSpinner.start(`Installing ${tool.name}...`);
          try {
            const { execFile: execFileCb } = await import("node:child_process");
            const { promisify } = await import("node:util");
            const execFileAsync = promisify(execFileCb);
            const parts = tool.installCmd.split(" ");
            await execFileAsync(parts[0], parts.slice(1), { cwd: projectDir });
            installSpinner.stop(`${tool.name} installed`);
          } catch {
            installSpinner.stop(`Failed to install ${tool.name}`);
            p.log.warn(`Could not install ${tool.name}. Run manually: ${tool.installCmd}`);
          }
        }
      } else if (installChoice === "choose") {
        const toInstall = await p.multiselect({
          message: "Select packages to install:",
          options: missingTools.map((t) => ({
            value: t.name,
            label: `${t.name} (${t.installCmd})`,
          })),
          required: false,
        });
        handleCancel(toInstall);

        for (const name of toInstall as string[]) {
          const tool = missingTools.find((t) => t.name === name);
          if (!tool) continue;
          const installSpinner = p.spinner();
          installSpinner.start(`Installing ${tool.name}...`);
          try {
            const { execFile: execFileCb } = await import("node:child_process");
            const { promisify } = await import("node:util");
            const execFileAsync = promisify(execFileCb);
            const parts = tool.installCmd.split(" ");
            await execFileAsync(parts[0], parts.slice(1), { cwd: projectDir });
            installSpinner.stop(`${tool.name} installed`);
          } catch {
            installSpinner.stop(`Failed to install ${tool.name}`);
            p.log.warn(`Could not install ${tool.name}. Run manually: ${tool.installCmd}`);
          }
        }
      }
    }
  }

  // Step 6: Generation
  const genSpinner = p.spinner();
  genSpinner.start("Generating harness files...");

  const generatedFiles: string[] = [];

  try {
    if (harnessConfig) {
      // NL or import mode: convert harness config to merged config via v2 (catalog pipeline)
      const { harnessToMergedConfigV2 } = await import("../../core/harness-converter-v2.js");
      const config = await harnessToMergedConfigV2(harnessConfig);
      const result = await generate({ projectDir, config });
      generatedFiles.push(...result.files);

      // Save harness.yaml
      const harnessYamlPath = path.join(projectDir, "harness.yaml");
      await fs.writeFile(harnessYamlPath, yaml.dump(harnessConfig, { lineWidth: 120 }), "utf-8");
      generatedFiles.push(harnessYamlPath);

      await writeHarnessState(projectDir, {
        presets: ["harness"],
        generatedAt: new Date().toISOString(),
      });
    } else if (presetNames) {
      // Preset mode
      const registry = new PresetRegistry();
      await registry.discover(presetsDir);
      const presetConfigs = await loadAndMergePresets(presetNames, registry);
      const config = mergePresets(presetConfigs);
      const result = await generate({ projectDir, config });
      generatedFiles.push(...result.files);

      await writeHarnessState(projectDir, {
        presets: presetNames,
        generatedAt: new Date().toISOString(),
      });
    }

    genSpinner.stop("Harness files generated");
  } catch (err) {
    genSpinner.stop("Generation failed");
    p.log.error(`Failed to generate files: ${(err as Error).message}`);
    p.cancel("Fix the issue and try again.");
    process.exit(1);
  }

  // Show generated files
  const fileList = generatedFiles
    .map((f) => `  ${chalk.green("\u2713")} ${path.relative(projectDir, f)}`)
    .join("\n");
  p.note(fileList, "Generated Files");

  // Step 7: Summary
  const summaryLines: string[] = [];
  summaryLines.push(`Generated ${generatedFiles.length} files in ${chalk.cyan(projectDir)}`);
  summaryLines.push("");

  if (harnessConfig) {
    const activeHooks = mergeEnforcementAndHooks(harnessConfig);
    if (activeHooks.length > 0) {
      summaryLines.push("Active hooks:");
      for (const hook of activeHooks) {
        summaryLines.push(`  \u2022 ${hook.block}`);
      }
      summaryLines.push("");
    }
  }

  summaryLines.push("Next steps:");
  summaryLines.push("  1. Review harness.yaml to customize");
  summaryLines.push("  2. Run oh-my-harness doctor to verify");
  summaryLines.push("  3. Restart your Claude Code session");

  p.note(summaryLines.join("\n"), "Harness configured successfully!");

  p.outro("Happy coding!");
}
