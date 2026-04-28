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

  // Strip ALL managed sections (including those still in config) so the
  // re-insertion below honors the new priority order. upsertManagedSection
  // does in-place replace when the marker exists, which would otherwise
  // freeze the original ordering.
  const existingIds = extractManagedSections(content).map((s) => s.id);
  for (const id of existingIds) {
    content = removeManagedSection(content, id);
  }
  // Normalize whitespace so repeated stripping doesn't accumulate blank lines.
  content = content.replace(/^\n+/, "").replace(/\n+$/, "");
  if (content) content += "\n";

  const sections = [...config.claudeMdSections].sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));

  for (const section of sections) {
    const sectionContent = section.content ?? "";
    content = upsertManagedSection(content, section.id, sectionContent);
  }

  await fs.writeFile(agentsMdPath, content, "utf8");
  return content;
}
