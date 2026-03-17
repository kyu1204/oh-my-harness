import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProject } from "../../src/detector/project-detector.js";
import { buildHarnessGenerationPrompt } from "../../src/nl/prompt-templates.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "omh-integ-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("detector to config end-to-end", () => {
  it("Node.js + TypeScript project → ProjectFacts contains typescript and npm", async () => {
    // Create a minimal Node.js + TypeScript project structure
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({
        name: "test-project",
        scripts: {
          test: "vitest run",
          lint: "eslint .",
          build: "tsc",
          typecheck: "tsc --noEmit",
        },
        devDependencies: {
          typescript: "^5.0.0",
          vitest: "^1.0.0",
        },
      }),
    );
    await writeFile(
      join(tmpDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true } }),
    );
    // npm detector only adds "npm" when package-lock.json exists
    await writeFile(join(tmpDir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }));

    const facts = await detectProject(tmpDir);

    expect(facts.languages).toContain("typescript");
    expect(facts.packageManagers).toContain("npm");
  });

  it("Python project structure → ProjectFacts contains python", async () => {
    // Create a minimal Python project structure
    await writeFile(
      join(tmpDir, "requirements.txt"),
      "fastapi\npytest\n",
    );
    await writeFile(
      join(tmpDir, "main.py"),
      "# Python entrypoint\n",
    );

    const facts = await detectProject(tmpDir);

    expect(facts.languages).toContain("python");
  });

  it("ProjectFacts → buildHarnessGenerationPrompt includes detected languages", async () => {
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({
        name: "ts-project",
        scripts: { test: "npx vitest run" },
        devDependencies: { typescript: "^5.0.0" },
      }),
    );
    await writeFile(
      join(tmpDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true } }),
    );

    const facts = await detectProject(tmpDir);
    const prompt = buildHarnessGenerationPrompt("TypeScript web app", undefined, facts);

    // Prompt must reference the detected language
    expect(prompt).toContain("typescript");
  });

  it("ProjectFacts → buildHarnessGenerationPrompt includes detected test commands", async () => {
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({
        name: "test-project",
        scripts: { test: "npx vitest run" },
        devDependencies: { typescript: "^5.0.0" },
      }),
    );

    const facts = await detectProject(tmpDir);

    // Inject a known test command into facts for assertion clarity
    const factsWithTest = {
      ...facts,
      testCommands: [...facts.testCommands, "npx vitest run"],
    };

    const prompt = buildHarnessGenerationPrompt("TypeScript project", undefined, factsWithTest);

    expect(prompt).toContain("npx vitest run");
    expect(prompt).toContain("Test commands");
  });

  it("ProjectFacts → buildHarnessGenerationPrompt includes detected package manager", async () => {
    // Create a pnpm project
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "pnpm-project", scripts: { test: "pnpm test" } }),
    );
    await writeFile(join(tmpDir, "pnpm-lock.yaml"), "lockfileVersion: '6.0'\n");

    const facts = await detectProject(tmpDir);

    const factsWithPm = {
      ...facts,
      packageManagers: [...new Set([...facts.packageManagers, "pnpm"])],
    };

    const prompt = buildHarnessGenerationPrompt("pnpm project", undefined, factsWithPm);

    expect(prompt).toContain("pnpm");
    expect(prompt).toContain("Package managers");
  });

  it("buildHarnessGenerationPrompt without facts omits the facts section", () => {
    const prompt = buildHarnessGenerationPrompt("Simple project");

    // Without facts the facts section header should not appear
    expect(prompt).not.toContain("Project facts (detected automatically)");
  });

  it("buildHarnessGenerationPrompt with empty facts omits the facts section", () => {
    const emptyFacts = {
      languages: [],
      frameworks: [],
      packageManagers: [],
      testCommands: [],
      lintCommands: [],
      buildCommands: [],
      typecheckCommands: [],
      blockedPaths: [],
      detectedFiles: [],
    };

    const prompt = buildHarnessGenerationPrompt("Simple project", undefined, emptyFacts);

    expect(prompt).not.toContain("Project facts (detected automatically)");
  });
});
