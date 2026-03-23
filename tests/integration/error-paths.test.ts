import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HarnessConfigSchema } from "../../src/core/harness-schema.js";
import { renderTemplate, validateParams } from "../../src/catalog/template-engine.js";
import { convertHookEntries } from "../../src/catalog/converter.js";
import { CatalogRegistry } from "../../src/catalog/registry.js";
import { generate } from "../../src/core/generator.js";
import { appendEvent, readEvents } from "../../src/cli/event-logger.js";
import { wrapWithLogger } from "../../src/generators/hooks.js";
import { generateClaudeMd } from "../../src/generators/claude-md.js";
import { detectProject } from "../../src/detector/project-detector.js";
import { initCommand } from "../../src/cli/commands/init.js";
import type { MergedConfig } from "../../src/core/preset-types.js";
import type { BuildingBlock } from "../../src/catalog/types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "omh-error-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Schema validation errors
// ---------------------------------------------------------------------------

describe("HarnessConfigSchema validation errors", () => {
  it("throws ZodError when version field has wrong literal value", () => {
    expect(() =>
      HarnessConfigSchema.parse({
        version: "2.0",
        project: { stacks: [] },
        rules: [],
        enforcement: { preCommit: [], blockedPaths: [], blockedCommands: [], postSave: [] },
      }),
    ).toThrow();
  });

  it("throws ZodError when preCommit is a string instead of array", () => {
    expect(() =>
      HarnessConfigSchema.parse({
        version: "1.0",
        project: { stacks: [] },
        rules: [],
        enforcement: {
          preCommit: "not-an-array",
          blockedPaths: [],
          blockedCommands: [],
          postSave: [],
        },
      }),
    ).toThrow();
  });

  it("parses successfully and ignores unknown fields (passthrough behaviour)", () => {
    const result = HarnessConfigSchema.parse({
      version: "1.0",
      project: { stacks: [] },
      rules: [],
      enforcement: { preCommit: [], blockedPaths: [], blockedCommands: [], postSave: [] },
      unknownExtraField: "should-be-ignored",
    });
    // Parsing must succeed
    expect(result.version).toBe("1.0");
    // The unknown field is stripped (strict schema — not present on result)
    expect((result as Record<string, unknown>).unknownExtraField).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Template engine errors
// ---------------------------------------------------------------------------

describe("renderTemplate and validateParams", () => {
  const mockBlock: BuildingBlock = {
    id: "test-block",
    name: "Test Block",
    description: "A block for testing",
    category: "custom",
    event: "PreToolUse",
    canBlock: false,
    tags: [],
    template: "Hello {{name}}!",
    params: [
      {
        name: "name",
        type: "string",
        description: "A name",
        required: true,
      },
    ],
  };

  it("validateParams returns error when required param is missing", () => {
    const errors = validateParams(mockBlock, {});
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("name");
  });

  it("validateParams returns no errors when required param is provided", () => {
    const errors = validateParams(mockBlock, { name: "World" });
    expect(errors).toHaveLength(0);
  });

  it("renderTemplate with empty template string returns empty string", () => {
    const result = renderTemplate("", { name: "World" });
    expect(result).toBe("");
  });

  it("renderTemplate renders correctly when required param is supplied", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });
});

// ---------------------------------------------------------------------------
// Catalog converter errors
// ---------------------------------------------------------------------------

describe("convertHookEntries", () => {
  it("records an error and skips when block id does not exist in registry", async () => {
    const registry = new CatalogRegistry();
    const result = await convertHookEntries(
      [{ block: "nonexistent-block", params: {} }],
      registry,
      tmpDir,
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("nonexistent-block");
    expect(result.scripts.size).toBe(0);
  });

  it("returns empty results and no errors when entries array is empty", async () => {
    const registry = new CatalogRegistry();
    const result = await convertHookEntries([], registry, tmpDir);
    expect(result.errors).toHaveLength(0);
    expect(result.scripts.size).toBe(0);
    expect(Object.keys(result.hooksConfig)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Generator errors
// ---------------------------------------------------------------------------

describe("generate() error paths", () => {
  it("generates CLAUDE.md even when hooks and sections are both empty", async () => {
    const config: MergedConfig = {
      presets: [],
      variables: {},
      claudeMdSections: [],
      hooks: { preToolUse: [], postToolUse: [] },
      settings: { permissions: { allow: [], deny: [] } },
    };

    const result = await generate({ projectDir: tmpDir, config });
    expect(result.files).toContain(join(tmpDir, "CLAUDE.md"));
  });

  it("throws when projectDir does not exist", async () => {
    const nonExistentDir = join(tmpDir, "does-not-exist");
    const config: MergedConfig = {
      presets: [],
      variables: {},
      claudeMdSections: [],
      hooks: { preToolUse: [], postToolUse: [] },
      settings: { permissions: { allow: [], deny: [] } },
    };

    // generate() will attempt to write into a non-existent directory; mkdir
    // is called recursively for .claude but CLAUDE.md itself sits directly in
    // projectDir — writeFile should throw ENOENT.
    await expect(generate({ projectDir: nonExistentDir, config })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Event logger errors
// ---------------------------------------------------------------------------

describe("readEvents error paths", () => {
  it("returns empty array when events file contains completely corrupted binary-like data", async () => {
    const stateDir = join(tmpDir, ".claude/hooks/.state");
    await mkdir(stateDir, { recursive: true });
    // Write non-JSON content that mimics corruption
    await writeFile(
      join(stateDir, "events.jsonl"),
      Buffer.from([0x00, 0x01, 0xff, 0xfe, 0xab, 0xcd]),
    );

    const events = await readEvents(tmpDir);
    expect(events).toEqual([]);
  });

  it("returns only valid events from a partially corrupted file", async () => {
    const stateDir = join(tmpDir, ".claude/hooks/.state");
    await mkdir(stateDir, { recursive: true });

    const validEvent = JSON.stringify({
      ts: "2024-01-01T00:00:00Z",
      event: "PreToolUse",
      hook: "test.sh",
      decision: "allow",
    });
    const mixedContent = [
      validEvent,
      "NOT_VALID_JSON{{{{",
      '{"ts":"2024-01-02T00:00:00Z","event":"PostToolUse","hook":"other.sh","decision":"block"}',
      "another-bad-line",
    ].join("\n");

    await writeFile(join(stateDir, "events.jsonl"), mixedContent, "utf-8");

    const events = await readEvents(tmpDir);
    expect(events).toHaveLength(2);
    expect(events[0].decision).toBe("allow");
    expect(events[1].decision).toBe("block");
  });

  it("throws when appendEvent target directory is read-only", async () => {
    const stateDir = join(tmpDir, ".claude/hooks/.state");
    await mkdir(stateDir, { recursive: true });
    // Make the state directory read-only so appendFile fails
    await chmod(stateDir, 0o444);

    const event = {
      ts: "2024-01-01T00:00:00Z",
      event: "PreToolUse",
      hook: "test.sh",
      decision: "allow" as const,
    };

    await expect(appendEvent(tmpDir, event)).rejects.toThrow();

    // Restore permissions for cleanup
    await chmod(stateDir, 0o755);
  });
});

// ---------------------------------------------------------------------------
// wrapWithLogger edge cases
// ---------------------------------------------------------------------------

describe("wrapWithLogger edge cases", () => {
  it("returns snippet prepended to content when script is empty string", () => {
    const result = wrapWithLogger("", "PreToolUse");
    expect(result).toContain("oh-my-harness event logger");
    // The snippet is prepended; script content (empty) follows
    expect(result.startsWith("# --- oh-my-harness event logger ---")).toBe(true);
  });

  it("prepends snippet when script has no shebang and no INPUT line", () => {
    const script = 'echo "hello world"';
    const result = wrapWithLogger(script, "PostToolUse");
    // Snippet must appear before the original script content
    const snippetIndex = result.indexOf("oh-my-harness event logger");
    const scriptIndex = result.indexOf('echo "hello world"');
    expect(snippetIndex).toBeLessThan(scriptIndex);
  });

  it("inserts snippet after shebang when script has a shebang line", () => {
    const script = "#!/bin/bash\necho hello";
    const result = wrapWithLogger(script, "PreToolUse");
    const shebangIndex = result.indexOf("#!/bin/bash");
    const snippetIndex = result.indexOf("oh-my-harness event logger");
    expect(shebangIndex).toBeLessThan(snippetIndex);
    expect(result).toContain("echo hello");
  });

  it("inserts snippet after INPUT=$(cat) when present", () => {
    const script = "#!/bin/bash\nINPUT=$(cat)\necho done";
    const result = wrapWithLogger(script, "PreToolUse");
    const inputIndex = result.indexOf("INPUT=$(cat)");
    const snippetIndex = result.indexOf("oh-my-harness event logger");
    expect(inputIndex).toBeLessThan(snippetIndex);
  });
});

// ---------------------------------------------------------------------------
// generateClaudeMd edge cases
// ---------------------------------------------------------------------------

describe("generateClaudeMd edge cases", () => {
  it("handles existing CLAUDE.md where managed section start marker exists but end marker is missing", async () => {
    // Write a CLAUDE.md with a broken managed block (no closing marker)
    const brokenContent =
      "# Existing content\n\n<!-- oh-my-harness:start:broken-section -->\nsome content without end marker\n";
    await writeFile(join(tmpDir, "CLAUDE.md"), brokenContent, "utf-8");

    const config: MergedConfig = {
      presets: ["test"],
      variables: {},
      claudeMdSections: [
        {
          id: "new-section",
          title: "New Section",
          content: "New content",
          priority: 50,
        },
      ],
      hooks: { preToolUse: [], postToolUse: [] },
      settings: { permissions: { allow: [], deny: [] } },
    };

    // Should not throw — it should gracefully handle the broken marker
    const result = await generateClaudeMd({ projectDir: tmpDir, config });
    expect(result).toContain("New content");
    // The broken section remains untouched (regex won't match without end marker)
    expect(result).toContain("<!-- oh-my-harness:start:broken-section -->");
  });
});

// ---------------------------------------------------------------------------
// initCommand — invalid preset name
// ---------------------------------------------------------------------------

describe("initCommand invalid preset", () => {
  it("prints user-friendly error and does not expose stack trace for unknown preset", async () => {
    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => logs.push(args.join(" "));

    let threw = false;
    try {
      await initCommand([], {
        yes: true,
        projectDir: tmpDir,
        presetsDir: resolve(import.meta.dirname, "../../presets"),
        preset: ["nonexistent_preset_xyz"],
      });
    } catch {
      threw = true;
    }

    console.error = originalError;

    // Should not propagate the raw error — it should be caught and logged
    expect(threw).toBe(false);
    expect(logs.some((l) => l.includes("nonexistent_preset_xyz"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectProject edge cases
// ---------------------------------------------------------------------------

describe("detectProject edge cases", () => {
  it("returns empty ProjectFacts for a completely empty directory", async () => {
    const facts = await detectProject(tmpDir);
    expect(facts.languages).toHaveLength(0);
    expect(facts.frameworks).toHaveLength(0);
    expect(facts.packageManagers).toHaveLength(0);
    expect(facts.testCommands).toHaveLength(0);
  });

  it("handles invalid (non-JSON) package.json gracefully without throwing", async () => {
    await writeFile(join(tmpDir, "package.json"), "THIS IS NOT JSON {{{", "utf-8");

    // detectProject swallows detector errors — must not throw
    const facts = await detectProject(tmpDir);
    // Result may or may not contain typescript depending on other files,
    // but it must return a valid ProjectFacts object.
    expect(Array.isArray(facts.languages)).toBe(true);
    expect(Array.isArray(facts.frameworks)).toBe(true);
  });
});
