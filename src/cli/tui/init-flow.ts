import * as p from "@clack/prompts";
import chalk from "chalk";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { checkDependencies } from "../deps-checker.js";
import type { DepCheck } from "../deps-checker.js";
import { checkReferencedTools } from "../tool-checker.js";
import type { ToolCheck } from "../tool-checker.js";
import { writeHarnessState } from "../commands/init.js";
import { generate } from "../../core/generator.js";
import { generateHarnessConfig, createDefaultRunner } from "../../nl/parse-intent.js";
import { hasProviderConfig } from "../../nl/config-store.js";
import { runProviderSetup } from "./provider-setup.js";
import { mergeEnforcementAndHooks } from "../../core/harness-converter-v2.js";
import type { HarnessConfig } from "../../core/harness-schema.js";
import { HarnessConfigSchema } from "../../core/harness-schema.js";
import { detectProject } from "../../detector/project-detector.js";
import { hasStarPromptBeenShown, markStarPromptShown, starRepo } from "../github-star.js";
import type { ProjectFacts } from "../../detector/types.js";

export function formatDepResults(deps: DepCheck[]): string {
  if (deps.length === 0) return "";
  const lines: string[] = [];
  for (const dep of deps) {
    if (dep.installed) {
      const version = dep.version ? ` (${dep.version})` : "";
      lines.push(`  ${chalk.green("✓")} ${dep.name}${chalk.dim(version)}`);
    } else if (dep.required) {
      lines.push(`  ${chalk.red("✗")} ${dep.name} ${chalk.red("missing")} — ${dep.installHint}`);
    } else {
      lines.push(`  ${chalk.yellow("○")} ${dep.name} ${chalk.yellow("optional")} — ${dep.installHint}`);
    }
  }
  return lines.join("\n");
}

export function formatConfigSummary(config: HarnessConfig): string {
  const lines: string[] = [];
  if (config.project.name) {
    lines.push(`  Project: ${chalk.cyan(config.project.name)}`);
  }
  const stackSummary = config.project.stacks
    .map((s) => `${s.name} (${s.framework}/${s.language})`)
    .join(", ");
  if (stackSummary) lines.push(`  Stack: ${stackSummary}`);
  if (config.rules.length > 0) {
    lines.push("");
    lines.push("  Rules:");
    for (let i = 0; i < config.rules.length; i++) {
      lines.push(`    ${i + 1}. ${config.rules[i].title} (priority: ${config.rules[i].priority})`);
    }
  }
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

export async function runInitTUI(options?: { projectDir?: string }): Promise<void> {
  const projectDir = options?.projectDir ?? process.cwd();

  p.intro(
    `${chalk.bgCyan(chalk.black(" oh-my-harness "))} ${chalk.dim("Tame your AI coding agents")}`,
  );

  // Dependency Check
  const depSpinner = p.spinner();
  depSpinner.start("Checking dependencies...");
  const deps = await checkDependencies();
  depSpinner.stop("Dependencies checked");
  const depOutput = formatDepResults(deps);
  p.note(depOutput, "System Dependencies");

  const missingRequired = deps.filter((d) => d.required && !d.installed);
  const claudeInstalled = deps.find((d) => d.name === "claude")?.installed ?? false;

  if (missingRequired.length > 0) {
    p.log.error(`Missing required dependencies: ${missingRequired.map((d) => d.name).join(", ")}`);
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

  // Project Detection
  const detectSpinner = p.spinner();
  detectSpinner.start("Detecting project type...");
  let projectFacts: ProjectFacts | undefined;
  try {
    const facts = await detectProject(projectDir);
    if (facts.languages.length > 0 || facts.frameworks.length > 0) projectFacts = facts;
    detectSpinner.stop("Project detected");
  } catch {
    detectSpinner.stop("Project detection skipped");
  }
  if (projectFacts) p.note(formatProjectFacts(projectFacts), "Detected Project");

  // Mode Selection
  type ModeValue = "nl" | "import";
  const modeOptions: Array<{ value: ModeValue; label: string; hint?: string }> = [
    claudeInstalled
      ? { value: "nl", label: "Describe your project (AI-powered)" }
      : { value: "nl", label: "Describe your project (AI-powered)", hint: "requires claude CLI" },
    { value: "import", label: "Import existing harness.yaml" },
  ];

  const mode = await p.select({ message: "How would you like to configure your harness?", options: modeOptions });
  handleCancel(mode);

  if (mode === "nl" && !claudeInstalled) {
    p.log.error("claude CLI is required for AI-powered mode. Install it with:");
    p.log.info("  npm install -g @anthropic-ai/claude-code");
    p.cancel("Cannot proceed without claude CLI.");
    process.exit(1);
  }

  let harnessConfig: HarnessConfig | undefined;

  if (mode === "nl") {
    const hasConfig = await hasProviderConfig();
    if (!hasConfig) {
      p.log.info("No AI provider configured yet. Let's set one up.");
      const providerConfig = await runProviderSetup();
      if (!providerConfig) {
        p.cancel("Provider setup cancelled.");
        process.exit(0);
      }
    }

    const runner = await createDefaultRunner();
    const description = await p.text({
      message: "Describe your project:",
      placeholder: "e.g., Next.js e-commerce app with Stripe and Tailwind",
      validate: (value) => { if (!value || !value.trim()) return "Please enter a project description"; },
    });
    handleCancel(description);

    const genSpinner = p.spinner();
    genSpinner.start("Generating harness configuration...");
    try {
      const { createDefaultRegistry } = await import("../../catalog/registry.js");
      const catalogRegistry = await createDefaultRegistry();
      const catalogBlocks = catalogRegistry.list().map((b) => ({
        id: b.id,
        description: b.description,
        params: b.params.map((pp) => ({ name: pp.name, required: pp.required, default: pp.default, description: pp.description })),
      }));
      harnessConfig = await generateHarnessConfig(description as string, runner, catalogBlocks, projectFacts);
      genSpinner.stop("Configuration generated");
    } catch (err) {
      genSpinner.stop("Generation failed");
      p.log.error(`Failed to generate config: ${(err as Error).message}`);
      p.cancel("Try again.");
      process.exit(1);
    }

    p.note(formatConfigSummary(harnessConfig), "Generated Configuration");
    const confirmed = await p.confirm({ message: "Proceed with this configuration?", initialValue: true });
    handleCancel(confirmed);
    if (!confirmed) { p.cancel("Aborted."); process.exit(0); }
  } else {
    // Import mode
    const importPath = await p.text({
      message: "Path to harness.yaml:",
      placeholder: "./harness.yaml",
      validate: (value) => { if (!value || !value.trim()) return "Please enter a file path"; },
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
      p.note(formatConfigSummary(harnessConfig), "Imported Configuration");
    } catch (err) {
      p.log.error(`Failed to read file: ${(err as Error).message}`);
      p.cancel("Check the file path and try again.");
      process.exit(1);
    }
  }

  // Missing Tool Check
  if (harnessConfig) {
    const toolResults = await checkReferencedTools(harnessConfig);
    const missingTools = toolResults.filter((t) => !t.installed);
    if (missingTools.length > 0) {
      const toolLines = missingTools
        .map((t) => `  ${chalk.yellow("⚠")} ${chalk.bold(t.name)} — Used in ${t.source}\n    ${chalk.dim("→")} ${t.installCmd}`)
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
      const toInstall = installChoice === "all"
        ? missingTools
        : installChoice === "choose"
          ? await (async () => {
              const chosen = await p.multiselect({
                message: "Select packages to install:",
                options: missingTools.map((t) => ({ value: t.name, label: `${t.name} (${t.installCmd})` })),
                required: false,
              });
              handleCancel(chosen);
              return missingTools.filter((t) => (chosen as string[]).includes(t.name));
            })()
          : [];
      for (const tool of toInstall as ToolCheck[]) {
        const s = p.spinner();
        s.start(`Installing ${tool.name}...`);
        try {
          const { execFile: execFileCb } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const parts = tool.installCmd.split(" ");
          await promisify(execFileCb)(parts[0], parts.slice(1), { cwd: projectDir });
          s.stop(`${tool.name} installed`);
        } catch {
          s.stop(`Failed to install ${tool.name}`);
          p.log.warn(`Could not install ${tool.name}. Run manually: ${tool.installCmd}`);
        }
      }
    }
  }

  // Generation
  const genSpinner = p.spinner();
  genSpinner.start("Generating harness files...");
  const generatedFiles: string[] = [];

  try {
    if (harnessConfig) {
      const { harnessToMergedConfigV2 } = await import("../../core/harness-converter-v2.js");
      const config = await harnessToMergedConfigV2(harnessConfig);
      const result = await generate({ projectDir, config });
      generatedFiles.push(...result.files);
      const harnessYamlPath = path.join(projectDir, "harness.yaml");
      await fs.writeFile(harnessYamlPath, yaml.dump(harnessConfig, { lineWidth: 120 }), "utf-8");
      generatedFiles.push(harnessYamlPath);
      await writeHarnessState(projectDir, { presets: ["harness"], generatedAt: new Date().toISOString() });
    }
    genSpinner.stop("Harness files generated");
  } catch (err) {
    genSpinner.stop("Generation failed");
    p.log.error(`Failed to generate files: ${(err as Error).message}`);
    p.cancel("Fix the issue and try again.");
    process.exit(1);
  }

  const fileList = generatedFiles
    .map((f) => `  ${chalk.green("✓")} ${path.relative(projectDir, f)}`)
    .join("\n");
  p.note(fileList, "Generated Files");

  const summaryLines = [
    `Generated ${generatedFiles.length} files in ${chalk.cyan(projectDir)}`,
    "",
    "Next steps:",
    "  1. Review harness.yaml to customize",
    "  2. Run oh-my-harness doctor to verify",
    "  3. Restart your Claude Code session",
  ];
  p.note(summaryLines.join("\n"), "Harness configured successfully!");

  try {
    if (!(await hasStarPromptBeenShown())) {
      const wantsStar = await p.confirm({ message: "Enjoying oh-my-harness? Star us on GitHub?", initialValue: true });
      await markStarPromptShown();
      if (!p.isCancel(wantsStar) && wantsStar) {
        try {
          const ok = await starRepo();
          p.log[ok ? "success" : "info"](ok ? "Thanks for the star!" : "Star us anytime: https://github.com/kyu1204/oh-my-harness");
        } catch {
          p.log.info("Star us anytime: https://github.com/kyu1204/oh-my-harness");
        }
      }
    }
  } catch {
    // Star prompt errors must never abort init
  }

  p.outro("Happy coding!");
}
