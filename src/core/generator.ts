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

  // Generate CLAUDE.md (Claude Code instructions)
  await generateClaudeMd({ projectDir, config });
  files.push(`${projectDir}/CLAUDE.md`);

  // Generate AGENTS.md (Codex instructions, same managed sections)
  await generateAgentsMd({ projectDir, config });
  files.push(`${projectDir}/AGENTS.md`);

  // Generate hook scripts (single source under .omh/hooks)
  const hooksOutput = await generateHooks({ projectDir, config });
  files.push(...hooksOutput.generatedFiles);

  // Generate Claude settings.json (references .omh/hooks/*.sh)
  await generateSettings({ projectDir, config, hooksOutput });
  files.push(`${projectDir}/.claude/settings.json`);

  // Generate Codex config (references same .omh/hooks/*.sh)
  const codexFiles = await generateCodexConfig({ projectDir, hooksOutput });
  files.push(...codexFiles);

  // Update .gitignore — only state is volatile log data; hooks/manifest are reproducible
  await updateGitignore(projectDir, [`${OMH_DIR}/state/`]);
  files.push(`${projectDir}/.gitignore`);

  return { files };
}
