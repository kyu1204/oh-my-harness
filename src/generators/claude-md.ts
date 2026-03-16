import fs from "node:fs/promises";
import path from "node:path";
import type { MergedConfig } from "../core/preset-types.js";
import { upsertManagedSection } from "../utils/markdown.js";

export interface GenerateClaudeMdOptions {
  projectDir: string;
  config: MergedConfig;
}

export async function generateClaudeMd(options: GenerateClaudeMdOptions): Promise<string> {
  const { projectDir, config } = options;
  const claudeMdPath = path.join(projectDir, "CLAUDE.md");

  // Read existing content or start fresh
  let content: string;
  try {
    content = await fs.readFile(claudeMdPath, "utf8");
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      content = "";
    } else {
      throw error;
    }
  }

  // Sort sections by priority (lower = higher in file)
  const sections = [...config.claudeMdSections].sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));

  // Upsert each section in priority order
  for (const section of sections) {
    const sectionContent = section.content ?? "";
    content = upsertManagedSection(content, section.id, sectionContent);
  }

  await fs.writeFile(claudeMdPath, content, "utf8");
  return content;
}
