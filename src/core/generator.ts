import type { MergedConfig } from "./preset-types.js";
import { generateClaudeMd } from "../generators/claude-md.js";
import { generateHooks } from "../generators/hooks.js";
import { generateSettings } from "../generators/settings.js";
import { updateGitignore } from "../generators/gitignore.js";

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

  // Generate CLAUDE.md
  await generateClaudeMd({ projectDir, config });
  files.push(`${projectDir}/CLAUDE.md`);

  // Generate hook scripts
  const hooksOutput = await generateHooks({ projectDir, config });
  files.push(...hooksOutput.generatedFiles);

  // Generate settings.json (needs hooks output for hooks config)
  await generateSettings({ projectDir, config, hooksOutput });
  files.push(`${projectDir}/.claude/settings.json`);

  // Update .gitignore
  await updateGitignore(projectDir, [".claude/hooks/", ".claude/hooks/.state/"]);
  files.push(`${projectDir}/.gitignore`);

  return { files };
}
