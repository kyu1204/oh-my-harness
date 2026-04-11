import { promises as fs } from "node:fs";
import path from "node:path";

const SECTION_HEADER = "# oh-my-harness";

export async function updateGitignore(projectDir: string, entries: string[]): Promise<void> {
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
    return;
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

  await fs.writeFile(gitignorePath, content, "utf-8");
}
