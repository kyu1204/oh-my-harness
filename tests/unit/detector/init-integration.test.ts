import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import type { ClaudeRunner } from "../../../src/nl/parse-intent.js";
import type { ProjectFacts } from "../../../src/detector/project-detector.js";

// We need to mock detectProject before importing initCommand
const mockDetectProject = vi.fn<[string], Promise<ProjectFacts>>();

vi.mock("../../../src/detector/project-detector.js", () => ({
  detectProject: mockDetectProject,
}));

// Also spy on generateHarnessConfig to capture projectFacts
const mockGenerateHarnessConfig = vi.fn<[string, ClaudeRunner, unknown, ProjectFacts?], Promise<unknown>>();

vi.mock("../../../src/nl/parse-intent.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/nl/parse-intent.js")>();
  return {
    ...original,
    generateHarnessConfig: mockGenerateHarnessConfig,
  };
});

const validHarness = {
  version: "1.0",
  project: {
    name: "test-app",
    stacks: [
      { name: "frontend", framework: "nextjs", language: "typescript", packageManager: "pnpm" },
    ],
  },
  rules: [
    { id: "test-rule", title: "Test Rule", content: "## Test Rule\n\n- rule", priority: 20 },
  ],
  enforcement: {
    preCommit: [],
    blockedPaths: [],
    blockedCommands: [],
    postSave: [],
  },
  permissions: { allow: [], deny: [] },
};

const PRESETS_DIR = path.resolve(import.meta.dirname, "../../../presets");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-init-integration-"));
  vi.clearAllMocks();

  // Default: detectProject returns empty facts
  mockDetectProject.mockResolvedValue({
    languages: [],
    frameworks: [],
    packageManagers: [],
    testCommands: [],
    lintCommands: [],
    buildCommands: [],
    typecheckCommands: [],
    blockedPaths: [],
    detectedFiles: [],
  });

  // Default: generateHarnessConfig returns valid harness
  mockGenerateHarnessConfig.mockResolvedValue(validHarness);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("NL init flow + detectProject integration", () => {
  it("calls detectProject with projectDir during NL init", async () => {
    const { initCommand } = await import("../../../src/cli/commands/init.js");
    const mockRunner: ClaudeRunner = async () => yaml.dump(validHarness);

    await initCommand([], {
      yes: true,
      projectDir: tmpDir,
      presetsDir: PRESETS_DIR,
      nlRunner: mockRunner,
    });

    expect(mockDetectProject).toHaveBeenCalledOnce();
    expect(mockDetectProject).toHaveBeenCalledWith(tmpDir);
  });

  it("passes detected facts to generateHarnessConfig", async () => {
    const facts: ProjectFacts = {
      languages: ["typescript"],
      frameworks: ["nextjs"],
      packageManagers: ["pnpm"],
      testCommands: ["pnpm test"],
      lintCommands: ["eslint ."],
      buildCommands: ["pnpm build"],
      typecheckCommands: ["tsc --noEmit"],
      blockedPaths: ["node_modules/"],
      detectedFiles: ["package.json", "tsconfig.json"],
    };
    mockDetectProject.mockResolvedValue(facts);

    const { initCommand } = await import("../../../src/cli/commands/init.js");
    const mockRunner: ClaudeRunner = async () => yaml.dump(validHarness);

    await initCommand([], {
      yes: true,
      projectDir: tmpDir,
      presetsDir: PRESETS_DIR,
      nlRunner: mockRunner,
    });

    // generateHarnessConfig should have been called with facts as 4th argument
    expect(mockGenerateHarnessConfig).toHaveBeenCalledOnce();
    const callArgs = mockGenerateHarnessConfig.mock.calls[0];
    expect(callArgs[3]).toEqual(facts);
  });

  it("continues with empty facts when detectProject fails", async () => {
    mockDetectProject.mockRejectedValue(new Error("detector crashed"));

    const { initCommand } = await import("../../../src/cli/commands/init.js");
    const mockRunner: ClaudeRunner = async () => yaml.dump(validHarness);

    // Should not throw
    await expect(
      initCommand([], {
        yes: true,
        projectDir: tmpDir,
        presetsDir: PRESETS_DIR,
        nlRunner: mockRunner,
      }),
    ).resolves.not.toThrow();

    // generateHarnessConfig still called
    expect(mockGenerateHarnessConfig).toHaveBeenCalledOnce();
    // facts arg should be empty/undefined fallback
    const callArgs = mockGenerateHarnessConfig.mock.calls[0];
    const factsArg = callArgs[3];
    // Either undefined or empty facts — no non-empty arrays
    if (factsArg !== undefined) {
      expect((factsArg as ProjectFacts).languages).toEqual([]);
      expect((factsArg as ProjectFacts).frameworks).toEqual([]);
    }
  });

  it("does not call detectProject for preset-based init", async () => {
    const { initCommand } = await import("../../../src/cli/commands/init.js");

    await initCommand(["_base"], {
      yes: true,
      projectDir: tmpDir,
      presetsDir: PRESETS_DIR,
    });

    expect(mockDetectProject).not.toHaveBeenCalled();
  });
});
