import fs from "node:fs/promises";
import path from "node:path";
import type { MergedConfig } from "../core/preset-types.js";
import { extractManagedSections, removeManagedSection, upsertManagedSection } from "../utils/markdown.js";

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

  // Strip ALL managed sections (including those still in config) so the
  // re-insertion below honors the new priority order. upsertManagedSection
  // does in-place replace when the marker exists, which would otherwise
  // freeze the original ordering.
  const existingIds = extractManagedSections(content).map((s) => s.id);
  for (const id of existingIds) {
    content = removeManagedSection(content, id);
  }
  // Normalize whitespace so repeated stripping doesn't accumulate blank lines
  // at the file edges (otherwise idempotency breaks across runs).
  content = content.replace(/^\n+/, "").replace(/\n+$/, "");
  if (content) content += "\n";

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
