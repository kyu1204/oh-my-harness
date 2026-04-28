import fs from "node:fs/promises";
import path from "node:path";
import type { MergedConfig } from "../core/preset-types.js";
import { extractManagedSections, removeManagedSection, upsertManagedSection } from "../utils/markdown.js";

export interface GenerateAgentsMdOptions {
  projectDir: string;
  config: MergedConfig;
}

export async function generateAgentsMd(options: GenerateAgentsMdOptions): Promise<string> {
  const { projectDir, config } = options;
  const agentsMdPath = path.join(projectDir, "AGENTS.md");

  let content: string;
  try {
    content = await fs.readFile(agentsMdPath, "utf8");
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      content = "";
    } else {
      throw error;
    }
  }

  const currentIds = new Set(config.claudeMdSections.map((s) => s.id));
  const existingIds = extractManagedSections(content).map((s) => s.id);
  for (const id of existingIds) {
    if (!currentIds.has(id)) {
      content = removeManagedSection(content, id);
    }
  }

  const sections = [...config.claudeMdSections].sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));

  for (const section of sections) {
    const sectionContent = section.content ?? "";
    content = upsertManagedSection(content, section.id, sectionContent);
  }

  await fs.writeFile(agentsMdPath, content, "utf8");
  return content;
}
