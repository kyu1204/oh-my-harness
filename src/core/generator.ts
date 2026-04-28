import type { MergedConfig } from "./preset-types.js";
import { generateClaudeMd } from "../generators/claude-md.js";
import { generateAgentsMd } from "../generators/agents-md.js";
import { generateHooks } from "../generators/hooks.js";
import { generateSettings } from "../generators/settings.js";
import { generateCodexConfig } from "../generators/codex-config.js";
import { updateGitignore } from "../generators/gitignore.js";
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

  // Claude settings.json and Codex config write to disjoint files using the
  // same hooksOutput — independent.
  const [, codexFiles] = await Promise.all([
    generateSettings({ projectDir, config, hooksOutput }),
    generateCodexConfig({ projectDir, hooksOutput }),
  ]);
  files.push(`${projectDir}/.claude/settings.json`, ...codexFiles);

  // .omh/state/ holds volatile log data; hooks/manifest are reproducible.
  await updateGitignore(projectDir, [`${OMH_DIR}/state/`]);
  files.push(`${projectDir}/.gitignore`);

  return { files };
}
