import path from "node:path";
import type { MergedConfig } from "../core/preset-types.js";
import { writeManagedMarkdown } from "./managed-md.js";

export interface GenerateAgentsMdOptions {
  projectDir: string;
  config: MergedConfig;
}

export async function generateAgentsMd(options: GenerateAgentsMdOptions): Promise<string> {
  return writeManagedMarkdown(
    path.join(options.projectDir, "AGENTS.md"),
    options.config.claudeMdSections,
  );
}
