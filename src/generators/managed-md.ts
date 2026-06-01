import fs from "node:fs/promises";
import type { ClaudeMdSection } from "../core/merged-config.js";
import { extractManagedSections, removeManagedSection, upsertManagedSection } from "../utils/markdown.js";
import { readFileOrDefault } from "../utils/fs-helpers.js";

/**
 * Compute the final managed-markdown content (merging into the existing file)
 * without writing it. Shared by the write path and the plan/drift path.
 */
export async function computeManagedMarkdown(
  filePath: string,
  sections: ClaudeMdSection[],
): Promise<string> {
  let content = await readFileOrDefault(filePath, "");

  // Strip ALL managed sections (including those still in config) so the
  // re-insertion below honors the new priority order. upsertManagedSection
  // does in-place replace when the marker exists, which would otherwise
  // freeze the original ordering.
  for (const { id } of extractManagedSections(content)) {
    content = removeManagedSection(content, id);
  }
  // Normalize whitespace so repeated stripping doesn't accumulate blank lines.
  content = content.replace(/^\n+/, "").replace(/\n+$/, "");
  if (content) content += "\n";

  const sorted = [...sections].sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));
  for (const section of sorted) {
    content = upsertManagedSection(content, section.id, section.content ?? "");
  }

  return content;
}

export async function writeManagedMarkdown(
  filePath: string,
  sections: ClaudeMdSection[],
): Promise<string> {
  const content = await computeManagedMarkdown(filePath, sections);
  await fs.writeFile(filePath, content, "utf8");
  return content;
}
