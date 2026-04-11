import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateClaudeMd } from "../../src/generators/claude-md.js";
import type { MergedConfig } from "../../src/core/preset-types.js";

function makeMergedConfig(overrides: Partial<MergedConfig> = {}): MergedConfig {
  return {
    presets: [],
    variables: {},
    claudeMdSections: [],
    hooks: { preToolUse: [], postToolUse: [] },
    settings: { permissions: { allow: [], deny: [] } },
    ...overrides,
  };
}

describe("generateClaudeMd", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("generates a fresh CLAUDE.md with sections ordered by priority", async () => {
    const config = makeMergedConfig({
      claudeMdSections: [
        { id: "section-b", title: "Section B", content: "## B\n- item b", priority: 20 },
        { id: "section-a", title: "Section A", content: "## A\n- item a", priority: 10 },
      ],
    });

    const result = await generateClaudeMd({ projectDir: tmpDir, config });

    // section-a (priority 10) should appear before section-b (priority 20)
    const posA = result.indexOf("<!-- oh-my-harness:start:section-a -->");
    const posB = result.indexOf("<!-- oh-my-harness:start:section-b -->");
    expect(posA).toBeGreaterThan(-1);
    expect(posB).toBeGreaterThan(-1);
    expect(posA).toBeLessThan(posB);

    // file should be written
    const written = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf8");
    expect(written).toBe(result);
  });

  it("updates existing CLAUDE.md without losing user content", async () => {
    const existing = `# My Project

Some user notes here.

More user content.
`;
    await fs.writeFile(path.join(tmpDir, "CLAUDE.md"), existing, "utf8");

    const config = makeMergedConfig({
      claudeMdSections: [
        { id: "rules", title: "Rules", content: "## Rules\n- Rule 1", priority: 50 },
      ],
    });

    const result = await generateClaudeMd({ projectDir: tmpDir, config });

    expect(result).toContain("Some user notes here.");
    expect(result).toContain("More user content.");
    expect(result).toContain("<!-- oh-my-harness:start:rules -->");
    expect(result).toContain("## Rules\n- Rule 1");
    expect(result).toContain("<!-- oh-my-harness:end:rules -->");
  });

  it("replaces managed section content on re-run (idempotent)", async () => {
    const config = makeMergedConfig({
      claudeMdSections: [
        { id: "rules", title: "Rules", content: "## Rules\n- Rule 1", priority: 50 },
      ],
    });

    const first = await generateClaudeMd({ projectDir: tmpDir, config });

    // Update section content
    const config2 = makeMergedConfig({
      claudeMdSections: [
        { id: "rules", title: "Rules", content: "## Rules\n- Rule 2 (updated)", priority: 50 },
      ],
    });

    const second = await generateClaudeMd({ projectDir: tmpDir, config: config2 });

    expect(second).toContain("Rule 2 (updated)");
    expect(second).not.toContain("Rule 1");

    // Running again with same config produces identical output
    const third = await generateClaudeMd({ projectDir: tmpDir, config: config2 });
    expect(third).toBe(second);

    // File on disk matches return value
    const onDisk = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf8");
    expect(onDisk).toBe(third);

    void first; // used only to trigger first write
  });

  it("removes managed sections that are no longer in config after sync", async () => {
    // First sync: config has rule-a
    const configWithA = makeMergedConfig({
      claudeMdSections: [
        { id: "rule-a", title: "Rule A", content: "## Rule A\n- item a", priority: 10 },
      ],
    });
    await generateClaudeMd({ projectDir: tmpDir, config: configWithA });

    // Second sync: config no longer has rule-a
    const configWithoutA = makeMergedConfig({
      claudeMdSections: [],
    });
    const result = await generateClaudeMd({ projectDir: tmpDir, config: configWithoutA });

    expect(result).not.toContain("<!-- oh-my-harness:start:rule-a -->");
    expect(result).not.toContain("<!-- oh-my-harness:end:rule-a -->");
    expect(result).not.toContain("item a");

    const written = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf8");
    expect(written).toBe(result);
  });

  it("handles empty config (no sections)", async () => {
    const config = makeMergedConfig();

    const result = await generateClaudeMd({ projectDir: tmpDir, config });

    expect(result).toBe("");
    const written = await fs.readFile(path.join(tmpDir, "CLAUDE.md"), "utf8");
    expect(written).toBe("");
  });

  it("includes sections from multiple presets", async () => {
    const config = makeMergedConfig({
      presets: ["_base", "nextjs"],
      claudeMdSections: [
        { id: "general-rules", title: "General Rules", content: "## General\n- Rule 1", priority: 10 },
        { id: "tdd-rules", title: "TDD", content: "## TDD\n- Write tests first", priority: 11 },
        { id: "nextjs-rules", title: "Next.js Rules", content: "## Next.js\n- Use App Router", priority: 20 },
      ],
    });

    const result = await generateClaudeMd({ projectDir: tmpDir, config });

    expect(result).toContain("<!-- oh-my-harness:start:general-rules -->");
    expect(result).toContain("<!-- oh-my-harness:start:tdd-rules -->");
    expect(result).toContain("<!-- oh-my-harness:start:nextjs-rules -->");

    const posGeneral = result.indexOf("<!-- oh-my-harness:start:general-rules -->");
    const posTdd = result.indexOf("<!-- oh-my-harness:start:tdd-rules -->");
    const posNextjs = result.indexOf("<!-- oh-my-harness:start:nextjs-rules -->");
    expect(posGeneral).toBeLessThan(posTdd);
    expect(posTdd).toBeLessThan(posNextjs);
  });
});
