import { describe, it, expect } from "vitest";
import { buildPresetSelectionPrompt, buildHarnessGenerationPrompt } from "../../src/nl/prompt-templates.js";
import { parseNaturalLanguage, generateHarnessConfig } from "../../src/nl/parse-intent.js";
import type { ClaudeRunner } from "../../src/nl/parse-intent.js";
import yaml from "js-yaml";

const samplePresets = [
  {
    name: "typescript",
    displayName: "TypeScript",
    description: "TypeScript project configuration",
    tags: ["typescript", "language"],
  },
  {
    name: "react",
    displayName: "React",
    description: "React frontend framework",
    tags: ["react", "frontend", "ui"],
  },
  {
    name: "testing",
    displayName: "Testing",
    description: "Testing configuration with vitest",
    tags: ["testing", "vitest"],
  },
];

describe("buildPresetSelectionPrompt", () => {
  it("includes the description in the prompt", () => {
    const prompt = buildPresetSelectionPrompt("I need a React app", samplePresets);
    expect(prompt).toContain("I need a React app");
  });

  it("includes all preset names in the prompt", () => {
    const prompt = buildPresetSelectionPrompt("test project", samplePresets);
    expect(prompt).toContain("typescript");
    expect(prompt).toContain("react");
    expect(prompt).toContain("testing");
  });

  it("includes preset descriptions in the prompt", () => {
    const prompt = buildPresetSelectionPrompt("test project", samplePresets);
    expect(prompt).toContain("TypeScript project configuration");
    expect(prompt).toContain("React frontend framework");
  });

  it("includes preset tags in the prompt", () => {
    const prompt = buildPresetSelectionPrompt("test project", samplePresets);
    expect(prompt).toContain("frontend");
    expect(prompt).toContain("vitest");
  });

  it("instructs to output JSON only", () => {
    const prompt = buildPresetSelectionPrompt("test project", samplePresets);
    expect(prompt.toLowerCase()).toContain("json");
  });

  it("returns a non-empty string", () => {
    const prompt = buildPresetSelectionPrompt("my app", samplePresets);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });
});

describe("parseNaturalLanguage", () => {
  it("parses valid JSON output from runner", async () => {
    const mockRunner: ClaudeRunner = async () =>
      JSON.stringify({
        presets: ["typescript", "react"],
        confidence: 0.95,
        explanation: "React app with TypeScript",
      });

    const result = await parseNaturalLanguage("I need a React TypeScript app", samplePresets, mockRunner);
    expect(result.presets).toEqual(["typescript", "react"]);
    expect(result.confidence).toBe(0.95);
    expect(result.explanation).toBe("React app with TypeScript");
  });

  it("passes the description to the runner via prompt", async () => {
    let capturedPrompt = "";
    const mockRunner: ClaudeRunner = async (prompt) => {
      capturedPrompt = prompt;
      return JSON.stringify({ presets: ["typescript"], confidence: 0.8, explanation: "ts project" });
    };

    await parseNaturalLanguage("unique-description-xyz", samplePresets, mockRunner);
    expect(capturedPrompt).toContain("unique-description-xyz");
  });

  it("throws on malformed JSON output", async () => {
    const mockRunner: ClaudeRunner = async () => "not valid json at all";

    await expect(parseNaturalLanguage("some description", samplePresets, mockRunner)).rejects.toThrow();
  });

  it("throws when JSON is missing required fields", async () => {
    const mockRunner: ClaudeRunner = async () => JSON.stringify({ foo: "bar" });

    await expect(parseNaturalLanguage("some description", samplePresets, mockRunner)).rejects.toThrow();
  });

  it("handles JSON embedded in extra text by extracting it", async () => {
    const mockRunner: ClaudeRunner = async () =>
      'Here is the result:\n{"presets": ["react"], "confidence": 0.7, "explanation": "react app"}\nDone.';

    const result = await parseNaturalLanguage("build a UI", samplePresets, mockRunner);
    expect(result.presets).toEqual(["react"]);
  });

  it("throws when claude CLI runner rejects (not available)", async () => {
    const mockRunner: ClaudeRunner = async () => {
      const err = new Error("spawn claude ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    };

    await expect(parseNaturalLanguage("some description", samplePresets, mockRunner)).rejects.toThrow(
      /claude.*not found|install.*claude|claude.*unavailable/i,
    );
  });

  it("returns presets array that is an array", async () => {
    const mockRunner: ClaudeRunner = async () =>
      JSON.stringify({ presets: ["testing"], confidence: 0.6, explanation: "needs tests" });

    const result = await parseNaturalLanguage("add tests", samplePresets, mockRunner);
    expect(Array.isArray(result.presets)).toBe(true);
  });
});

describe("buildHarnessGenerationPrompt", () => {
  it("includes the description in the prompt", () => {
    const prompt = buildHarnessGenerationPrompt("A Next.js e-commerce app");
    expect(prompt).toContain("A Next.js e-commerce app");
  });

  it("includes YAML in the prompt", () => {
    const prompt = buildHarnessGenerationPrompt("my app");
    expect(prompt.toLowerCase()).toContain("yaml");
  });

  it("includes schema fields in the prompt", () => {
    const prompt = buildHarnessGenerationPrompt("my app");
    expect(prompt).toContain("version");
    expect(prompt).toContain("project");
    expect(prompt).toContain("rules");
    expect(prompt).toContain("enforcement");
    expect(prompt).toContain("permissions");
  });

  it("includes few-shot examples", () => {
    const prompt = buildHarnessGenerationPrompt("my app");
    expect(prompt).toContain("Example");
  });
});

describe("generateHarnessConfig", () => {
  const validYaml = yaml.dump({
    version: "1.0",
    project: {
      name: "my-app",
      description: "An e-commerce app",
      stacks: [
        {
          name: "frontend",
          framework: "nextjs",
          language: "typescript",
          packageManager: "pnpm",
          testRunner: "vitest",
          linter: "eslint",
        },
      ],
    },
    rules: [
      {
        id: "nextjs-rules",
        title: "Next.js Rules",
        content: "Use App Router",
        priority: 20,
      },
    ],
    enforcement: {
      preCommit: ["test"],
      blockedPaths: [".next/"],
      blockedCommands: [],
      postSave: [],
    },
    permissions: {
      allow: ["Bash(pnpm test*)"],
      deny: [],
    },
  });

  it("parses valid YAML output from runner into HarnessConfig", async () => {
    const mockRunner: ClaudeRunner = async () => validYaml;
    const result = await generateHarnessConfig("build me an e-commerce app", mockRunner);
    expect(result.version).toBe("1.0");
    expect(result.project.stacks).toHaveLength(1);
    expect(result.project.stacks[0].framework).toBe("nextjs");
    expect(result.rules).toHaveLength(1);
  });

  it("extracts YAML from markdown code block", async () => {
    const mockRunner: ClaudeRunner = async () =>
      "Here is the config:\n```yaml\n" + validYaml + "\n```\nDone.";
    const result = await generateHarnessConfig("an app", mockRunner);
    expect(result.version).toBe("1.0");
    expect(result.project.stacks[0].framework).toBe("nextjs");
  });

  it("throws on invalid YAML output", async () => {
    const mockRunner: ClaudeRunner = async () => "not: [valid: yaml: {{{";
    await expect(generateHarnessConfig("some app", mockRunner)).rejects.toThrow();
  });

  it("throws when YAML is missing required schema fields", async () => {
    const mockRunner: ClaudeRunner = async () => yaml.dump({ version: "1.0", project: {} });
    await expect(generateHarnessConfig("some app", mockRunner)).rejects.toThrow();
  });

  it("passes the description to the runner via prompt", async () => {
    let capturedPrompt = "";
    const mockRunner: ClaudeRunner = async (prompt) => {
      capturedPrompt = prompt;
      return validYaml;
    };
    await generateHarnessConfig("unique-description-abc", mockRunner);
    expect(capturedPrompt).toContain("unique-description-abc");
  });

  it("throws when claude CLI runner rejects (not available)", async () => {
    const mockRunner: ClaudeRunner = async () => {
      const err = new Error("spawn claude ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    };
    await expect(generateHarnessConfig("some app", mockRunner)).rejects.toThrow(
      /claude.*not found|install.*claude|claude.*unavailable/i,
    );
  });
});
