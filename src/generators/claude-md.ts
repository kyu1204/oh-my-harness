import path from "node:path";
import type { MergedConfig } from "../core/preset-types.js";
import { writeManagedMarkdown } from "./managed-md.js";

export interface GenerateClaudeMdOptions {
  projectDir: string;
  config: MergedConfig;
}

export async function generateClaudeMd(options: GenerateClaudeMdOptions): Promise<string> {
  return writeManagedMarkdown(
    path.join(options.projectDir, "CLAUDE.md"),
    options.config.claudeMdSections,
  );
}
