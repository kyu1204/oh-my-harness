import fs from "node:fs/promises";
import path from "node:path";
import type { MergedConfig } from "./merged-config.js";
import type { GenerationPlan, PlannedFile } from "./plan.js";
import { generateClaudeMd } from "../generators/claude-md.js";
import { generateAgentsMd } from "../generators/agents-md.js";
import { generateHooks, computeHooks } from "../generators/hooks.js";
import { generateSettings, computeSettings } from "../generators/settings.js";
import { generateCodexConfig, computeCodexConfig } from "../generators/codex-config.js";
import { generatePiExtension, computePiExtension } from "../generators/pi-extension.js";
import { updateGitignore, computeGitignore } from "../generators/gitignore.js";
import { computeManagedMarkdown } from "../generators/managed-md.js";
import { computeLoopAssets } from "../generators/loop-assets.js";
import { migrateLegacyState } from "../utils/state-migration.js";
import { OMH_DIR } from "../utils/paths.js";

export interface GenerateOptions {
  projectDir: string;
  config: MergedConfig;
}

export interface GenerateResult {
  files: string[]; // list of generated/modified files
}

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const { projectDir, config } = options;
  const files: string[] = [];

  // One-time migration of legacy .claude/hooks/.state → .omh/state
  await migrateLegacyState(projectDir);

  // CLAUDE.md and AGENTS.md operate on disjoint files with the same input.
  await Promise.all([
    generateClaudeMd({ projectDir, config }),
    generateAgentsMd({ projectDir, config }),
  ]);
  files.push(`${projectDir}/CLAUDE.md`, `${projectDir}/AGENTS.md`);

  // Hook scripts (single source under .omh/hooks). Settings + Codex both
  // depend on hooksOutput, so this stage runs first.
  const hooksOutput = await generateHooks({ projectDir, config });
  files.push(...hooksOutput.generatedFiles);

  // Claude settings.json, Codex config, and the Pi bridge extension write to
  // disjoint files using the same hooksOutput — independent.
  const [, codexFiles, piFiles] = await Promise.all([
    generateSettings({ projectDir, config, hooksOutput }),
    generateCodexConfig({ projectDir, hooksOutput }),
    generatePiExtension({ projectDir, hooksOutput }),
  ]);
  files.push(`${projectDir}/.claude/settings.json`, ...codexFiles, ...piFiles);

  // Loop-engine assets (runner, and later the skill/monitor/templates). Emitted
  // through the same compute function as the plan path so drift detection sees
  // them; skipped entirely when the loop engine is not configured.
  const loopAssets = await computeLoopAssets({ projectDir, config });
  for (const asset of loopAssets) {
    await fs.mkdir(path.dirname(asset.path), { recursive: true });
    await fs.writeFile(asset.path, asset.content, "utf-8");
    if (asset.chmod !== undefined) await fs.chmod(asset.path, asset.chmod);
    files.push(asset.path);
  }

  // .omh/state/ holds volatile log data; hooks/manifest are reproducible.
  await updateGitignore(projectDir, [
    `${OMH_DIR}/state/`,
    // The loop's isolated worktree lives inside the repo; without this it (and
    // everything the loop builds there) shows up as untracked in the main tree.
    ...(config.loop?.isolate ? [`${OMH_DIR}/loop/worktree/`] : []),
  ]);
  files.push(`${projectDir}/.gitignore`);

  return { files };
}

/**
 * Compute every file `generate()` would write — and the stale files it would
 * remove — WITHOUT touching disk. Backs `omh sync --check`, `omh diff`, and the
 * doctor drift warning. Uses the same compute functions as the write path, so
 * the plan can never disagree with what a real sync produces.
 *
 * The bookkeeping files that embed timestamps (.omh/manifest.json and
 * .claude/oh-my-harness.json) are intentionally excluded — they change every
 * run and are not part of the reproducible harness output.
 */
export async function planGenerate(options: GenerateOptions): Promise<GenerationPlan> {
  const { projectDir, config } = options;
  const files: PlannedFile[] = [];

  const hooksPlan = await computeHooks({ projectDir, config });
  const hooksOutput = { hooksConfig: hooksPlan.hooksConfig, generatedFiles: hooksPlan.generatedFiles };

  const [claudeMd, agentsMd, settings, codexFiles, piFiles, gitignore] = await Promise.all([
    computeManagedMarkdown(path.join(projectDir, "CLAUDE.md"), config.claudeMdSections),
    computeManagedMarkdown(path.join(projectDir, "AGENTS.md"), config.claudeMdSections),
    computeSettings({ projectDir, config, hooksOutput }),
    computeCodexConfig({ projectDir, hooksOutput }),
    Promise.resolve(computePiExtension({ projectDir, hooksOutput })),
    computeGitignore(projectDir, [`${OMH_DIR}/state/`]),
  ]);

  files.push({ path: path.join(projectDir, "CLAUDE.md"), content: claudeMd });
  files.push({ path: path.join(projectDir, "AGENTS.md"), content: agentsMd });
  files.push(...hooksPlan.files);
  files.push(settings);
  files.push(...codexFiles);
  files.push(...piFiles);
  files.push(...(await computeLoopAssets({ projectDir, config })));
  if (gitignore) files.push(gitignore);

  return { files, wouldDelete: hooksPlan.wouldDelete };
}
