import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateClaudeMd } from "../../src/generators/claude-md.js";
import { extractManagedSections, hasManagedSection } from "../../src/utils/markdown.js";
import type { MergedConfig } from "../../src/core/preset-types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "omh-integ-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeConfig(sections: MergedConfig["claudeMdSections"]): MergedConfig {
  return {
    presets: [],
    variables: {},
    claudeMdSections: sections,
    hooks: { preToolUse: [], postToolUse: [] },
    settings: { permissions: { allow: [], deny: [] } },
  };
}

describe("generateClaudeMd()", () => {
  it("creates CLAUDE.md with managed section markers in a blank project", async () => {
    const config = makeConfig([
      { id: "tdd-rules", title: "TDD Rules", content: "Write tests first", priority: 10 },
    ]);

    await generateClaudeMd({ projectDir: tmpDir, config });

    const content = await readFile(join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(content).toContain("<!-- oh-my-harness:start:tdd-rules -->");
    expect(content).toContain("<!-- oh-my-harness:end:tdd-rules -->");
    expect(content).toContain("Write tests first");
  });

  it("updates only managed sections and preserves existing user content", async () => {
    const claudeMdPath = join(tmpDir, "CLAUDE.md");
    await writeFile(
      claudeMdPath,
      "# My Project\n\nThis is my custom content that should be preserved.\n",
      "utf-8",
    );

    const config = makeConfig([
      { id: "managed-rules", title: "Managed Rules", content: "Managed content here", priority: 10 },
    ]);

    await generateClaudeMd({ projectDir: tmpDir, config });

    const content = await readFile(claudeMdPath, "utf-8");
    expect(content).toContain("This is my custom content that should be preserved.");
    expect(content).toContain("Managed content here");
    expect(content).toContain("<!-- oh-my-harness:start:managed-rules -->");
  });

  it("removing a section from config does not remove existing managed sections on regeneration", async () => {
    const claudeMdPath = join(tmpDir, "CLAUDE.md");

    // First generate with two sections
    const configWithTwo = makeConfig([
      { id: "section-one", title: "Section One", content: "Content one", priority: 10 },
      { id: "section-two", title: "Section Two", content: "Content two", priority: 20 },
    ]);
    await generateClaudeMd({ projectDir: tmpDir, config: configWithTwo });

    let content = await readFile(claudeMdPath, "utf-8");
    expect(hasManagedSection(content, "section-one")).toBe(true);
    expect(hasManagedSection(content, "section-two")).toBe(true);

    // Now regenerate with only one section — section-two should remain in file
    // (generateClaudeMd only upserts, does not remove absent sections)
    // But section-one content can be updated independently
    const configWithOne = makeConfig([
      { id: "section-one", title: "Section One", content: "Updated content one", priority: 10 },
    ]);
    await generateClaudeMd({ projectDir: tmpDir, config: configWithOne });

    content = await readFile(claudeMdPath, "utf-8");
    expect(content).toContain("Updated content one");
    // section-two marker still present (upsert doesn't remove)
    expect(hasManagedSection(content, "section-two")).toBe(true);
  });

  it("manages multiple sections simultaneously in correct priority order", async () => {
    const config = makeConfig([
      { id: "high-priority", title: "High", content: "High priority content", priority: 5 },
      { id: "low-priority", title: "Low", content: "Low priority content", priority: 90 },
      { id: "mid-priority", title: "Mid", content: "Mid priority content", priority: 50 },
    ]);

    await generateClaudeMd({ projectDir: tmpDir, config });

    const content = await readFile(join(tmpDir, "CLAUDE.md"), "utf-8");
    const sections = extractManagedSections(content);
    const ids = sections.map((s) => s.id);

    expect(ids).toContain("high-priority");
    expect(ids).toContain("mid-priority");
    expect(ids).toContain("low-priority");

    // high-priority should appear before low-priority in the file
    const highPos = content.indexOf("<!-- oh-my-harness:start:high-priority -->");
    const lowPos = content.indexOf("<!-- oh-my-harness:start:low-priority -->");
    expect(highPos).toBeLessThan(lowPos);
  });

  it("updates managed section content on second call without duplicating markers", async () => {
    const config1 = makeConfig([
      { id: "updatable", title: "Updatable", content: "Original content", priority: 10 },
    ]);
    await generateClaudeMd({ projectDir: tmpDir, config: config1 });

    const config2 = makeConfig([
      { id: "updatable", title: "Updatable", content: "Updated content", priority: 10 },
    ]);
    await generateClaudeMd({ projectDir: tmpDir, config: config2 });

    const content = await readFile(join(tmpDir, "CLAUDE.md"), "utf-8");
    const startCount = (content.match(/<!-- oh-my-harness:start:updatable -->/g) ?? []).length;
    expect(startCount).toBe(1);
    expect(content).toContain("Updated content");
    expect(content).not.toContain("Original content");
  });
});
