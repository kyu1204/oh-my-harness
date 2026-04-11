import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { updateGitignore } from "../../src/generators/gitignore.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-gitignore-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("updateGitignore", () => {
  it("creates section in new .gitignore", async () => {
    await updateGitignore(tmpDir, [".claude/hooks/*.sh", ".omh-cache/"]);

    const content = await fs.readFile(path.join(tmpDir, ".gitignore"), "utf-8");

    expect(content).toContain("# oh-my-harness");
    expect(content).toContain(".claude/hooks/*.sh");
    expect(content).toContain(".omh-cache/");
  });

  it("appends to existing .gitignore", async () => {
    const existing = "node_modules/\ndist/\n";
    await fs.writeFile(path.join(tmpDir, ".gitignore"), existing);

    await updateGitignore(tmpDir, [".claude/hooks/*.sh"]);

    const content = await fs.readFile(path.join(tmpDir, ".gitignore"), "utf-8");

    // Original content preserved
    expect(content).toContain("node_modules/");
    expect(content).toContain("dist/");
    // New section appended
    expect(content).toContain("# oh-my-harness");
    expect(content).toContain(".claude/hooks/*.sh");
  });

  it("skips duplicate entries (idempotent)", async () => {
    await updateGitignore(tmpDir, [".claude/hooks/*.sh", ".omh-cache/"]);
    await updateGitignore(tmpDir, [".claude/hooks/*.sh", ".omh-cache/"]);

    const content = await fs.readFile(path.join(tmpDir, ".gitignore"), "utf-8");

    // Section header appears only once
    const headerCount = (content.match(/# oh-my-harness/g) ?? []).length;
    expect(headerCount).toBe(1);

    // Each entry appears only once
    const shCount = (content.match(/\.claude\/hooks\/\*\.sh/g) ?? []).length;
    expect(shCount).toBe(1);
  });

  it("handles CRLF line endings without creating duplicate sections", async () => {
    // Write gitignore with Windows line endings (CRLF)
    const crlfContent = "node_modules/\r\ndist/\r\n# oh-my-harness\r\n.old-entry/\r\n";
    await fs.writeFile(path.join(tmpDir, ".gitignore"), crlfContent);

    // Update with new entries
    await updateGitignore(tmpDir, [".claude/hooks/*.sh"]);

    const content = await fs.readFile(path.join(tmpDir, ".gitignore"), "utf-8");

    // Section header should appear only once (not duplicated)
    const headerCount = (content.match(/# oh-my-harness/g) ?? []).length;
    expect(headerCount).toBe(1);

    // New entry should be added
    expect(content).toContain(".claude/hooks/*.sh");
  });
});
