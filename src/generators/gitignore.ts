import { promises as fs } from "node:fs";
import path from "node:path";

const SECTION_HEADER = "# oh-my-harness";

/**
 * Compute the final .gitignore content after ensuring `entries` are present,
 * without writing. Returns `{ path, content }`, or `null` when all entries are
 * already present (no change needed).
 */
export async function computeGitignore(
  projectDir: string,
  entries: string[],
): Promise<{ path: string; content: string } | null> {
  const gitignorePath = path.join(projectDir, ".gitignore");

  let content = "";
  try {
    content = await fs.readFile(gitignorePath, "utf-8");
  } catch {
    // File doesn't exist — start with empty content
  }

  // Collect entries already present anywhere in the file
  // Normalize CRLF to LF before processing to handle Windows line endings
  const lines = content.split("\n").map(line => line.replace(/\r$/, ""));
  const existingLines = new Set(lines.map((l) => l.trim()));

  // Filter to only entries not yet present
  const newEntries = entries.filter((e) => !existingLines.has(e));

  if (newEntries.length === 0) {
    // All entries already present; nothing to do
    return null;
  }

  // Check if our section header already exists
  const hasSection = existingLines.has(SECTION_HEADER);

  if (hasSection) {
    // Append new entries after the existing section header
    const headerIdx = lines.findIndex((l) => l.trim() === SECTION_HEADER);
    lines.splice(headerIdx + 1, 0, ...newEntries);
    content = lines.join("\n");
  } else {
    // Append a new section at the end
    const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    content = content + separator + "\n" + SECTION_HEADER + "\n" + newEntries.join("\n") + "\n";
  }

  return { path: gitignorePath, content };
}

export async function updateGitignore(projectDir: string, entries: string[]): Promise<void> {
  const planned = await computeGitignore(projectDir, entries);
  if (!planned) return;
  await fs.writeFile(planned.path, planned.content, "utf-8");
}
