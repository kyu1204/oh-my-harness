import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateAgentsMd } from "../../src/generators/agents-md.js";
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

describe("generateAgentsMd", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-agents-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("generates AGENTS.md (not CLAUDE.md) with same managed sections", async () => {
    const config = makeMergedConfig({
      claudeMdSections: [
        { id: "rules", title: "Rules", content: "## Rules\n- be tidy", priority: 10 },
      ],
    });

    const result = await generateAgentsMd({ projectDir: tmpDir, config });

    expect(result).toContain("<!-- oh-my-harness:start:rules -->");
    expect(result).toContain("- be tidy");
    expect(result).toContain("<!-- oh-my-harness:end:rules -->");

    const written = await fs.readFile(path.join(tmpDir, "AGENTS.md"), "utf8");
    expect(written).toBe(result);

    // Should not write CLAUDE.md
    await expect(fs.access(path.join(tmpDir, "CLAUDE.md"))).rejects.toThrow();
  });

  it("preserves user content outside managed markers", async () => {
    const existing = "# Project\n\nUser-authored notes.\n";
    await fs.writeFile(path.join(tmpDir, "AGENTS.md"), existing, "utf8");

    const config = makeMergedConfig({
      claudeMdSections: [
        { id: "rules", title: "Rules", content: "## Rules\n- rule 1", priority: 50 },
      ],
    });

    const result = await generateAgentsMd({ projectDir: tmpDir, config });

    expect(result).toContain("User-authored notes.");
    expect(result).toContain("- rule 1");
  });

  it("orders sections by priority (lower first)", async () => {
    const config = makeMergedConfig({
      claudeMdSections: [
        { id: "second", title: "B", content: "## B", priority: 20 },
        { id: "first", title: "A", content: "## A", priority: 10 },
      ],
    });

    const result = await generateAgentsMd({ projectDir: tmpDir, config });

    const posFirst = result.indexOf("<!-- oh-my-harness:start:first -->");
    const posSecond = result.indexOf("<!-- oh-my-harness:start:second -->");
    expect(posFirst).toBeLessThan(posSecond);
  });

  it("removes managed sections that are no longer in config", async () => {
    await generateAgentsMd({
      projectDir: tmpDir,
      config: makeMergedConfig({
        claudeMdSections: [{ id: "rule-x", title: "X", content: "## X\n- x", priority: 10 }],
      }),
    });

    const result = await generateAgentsMd({
      projectDir: tmpDir,
      config: makeMergedConfig({ claudeMdSections: [] }),
    });

    expect(result).not.toContain("rule-x");
    expect(result).not.toContain("- x");
  });

  it("is idempotent on re-run", async () => {
    const config = makeMergedConfig({
      claudeMdSections: [{ id: "rules", title: "R", content: "## R\n- r", priority: 50 }],
    });

    const first = await generateAgentsMd({ projectDir: tmpDir, config });
    const second = await generateAgentsMd({ projectDir: tmpDir, config });

    expect(second).toBe(first);
  });

  it("re-orders existing managed sections when priorities change", async () => {
    // First run: A=10, B=20 → A appears first
    await generateAgentsMd({
      projectDir: tmpDir,
      config: makeMergedConfig({
        claudeMdSections: [
          { id: "alpha", title: "A", content: "## A", priority: 10 },
          { id: "beta", title: "B", content: "## B", priority: 20 },
        ],
      }),
    });

    // Second run: priorities flipped → B should now appear first
    const result = await generateAgentsMd({
      projectDir: tmpDir,
      config: makeMergedConfig({
        claudeMdSections: [
          { id: "alpha", title: "A", content: "## A", priority: 20 },
          { id: "beta", title: "B", content: "## B", priority: 10 },
        ],
      }),
    });

    const posAlpha = result.indexOf("<!-- oh-my-harness:start:alpha -->");
    const posBeta = result.indexOf("<!-- oh-my-harness:start:beta -->");
    expect(posBeta).toBeLessThan(posAlpha);
  });
});
