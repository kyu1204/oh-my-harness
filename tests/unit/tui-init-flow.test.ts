import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { formatDepResults, formatConfigSummary, formatProjectFacts, buildPresetExtends } from "../../src/cli/tui/init-flow.js";
import type { DepCheck } from "../../src/cli/deps-checker.js";
import type { HarnessConfig } from "../../src/core/harness-schema.js";
import { emptyFacts } from "../../src/detector/types.js";
// updated: TUI init now passes catalogBlocks to generateHarnessConfig

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-tui-init-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@clack/prompts");
  vi.doUnmock("../../src/cli/deps-checker.js");
  vi.doUnmock("../../src/cli/tool-checker.js");
  vi.doUnmock("../../src/detector/project-detector.js");
  vi.doUnmock("../../src/nl/config-store.js");
  vi.doUnmock("../../src/nl/parse-intent.js");
  vi.doUnmock("../../src/core/generator.js");
  vi.doUnmock("../../src/cli/commands/init.js");
  vi.doUnmock("../../src/core/harness-converter-v2.js");
  vi.doUnmock("../../src/catalog/registry.js");
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("formatDepResults", () => {
  it("formats installed deps with checkmark and version", () => {
    const deps: DepCheck[] = [
      {
        name: "git",
        command: "git --version",
        required: true,
        purpose: "Version control",
        installHint: "brew install git",
        installed: true,
        version: "2.43.0",
      },
    ];
    const output = formatDepResults(deps);
    expect(output).toContain("git");
    expect(output).toContain("2.43.0");
  });

  it("formats missing required deps with error indicator", () => {
    const deps: DepCheck[] = [
      {
        name: "jq",
        command: "jq --version",
        required: true,
        purpose: "Parses tool input in hook scripts",
        installHint: "brew install jq",
        installed: false,
      },
    ];
    const output = formatDepResults(deps);
    expect(output).toContain("jq");
    expect(output).toContain("missing");
  });

  it("formats missing optional deps with warning indicator", () => {
    const deps: DepCheck[] = [
      {
        name: "claude",
        command: "claude --version",
        required: false,
        purpose: "Enables natural language harness generation",
        installHint: "npm install -g @anthropic-ai/claude-code",
        installed: false,
      },
    ];
    const output = formatDepResults(deps);
    expect(output).toContain("claude");
    expect(output).toContain("optional");
  });

  it("handles empty deps array", () => {
    const output = formatDepResults([]);
    expect(output).toBe("");
  });
});

describe("formatConfigSummary", () => {
  it("includes project name and stack info", () => {
    const config: HarnessConfig = {
      version: "1.0",
      project: {
        name: "my-app",
        description: "A test project",
        stacks: [{ name: "frontend", framework: "nextjs", language: "typescript" }],
      },
      rules: [{ id: "r1", title: "TDD Mandatory", content: "content", priority: 10 }],
      enforcement: {
        preCommit: [],
        blockedPaths: [],
        blockedCommands: [],
        postSave: [],
      },
      hooks: [
        { block: "commit-test-gate", params: { testCommand: "npx vitest run" } },
        { block: "path-guard", params: { blockedPaths: ["dist/"] } },
        { block: "lint-on-save", params: { filePattern: "*.ts", command: "eslint --fix" } },
      ],
      permissions: { allow: [], deny: [] },
    };
    const output = formatConfigSummary(config);
    expect(output).toContain("my-app");
    expect(output).toContain("nextjs");
    expect(output).toContain("typescript");
  });

  it("includes rules summary", () => {
    const config: HarnessConfig = {
      version: "1.0",
      project: {
        stacks: [{ name: "app", framework: "react", language: "typescript" }],
      },
      rules: [
        { id: "r1", title: "TDD Mandatory", content: "content", priority: 10 },
        { id: "r2", title: "TypeScript Rules", content: "content", priority: 20 },
      ],
      enforcement: { preCommit: [], blockedPaths: [], blockedCommands: [], postSave: [] },
      hooks: [],
      permissions: { allow: [], deny: [] },
    };
    const output = formatConfigSummary(config);
    expect(output).toContain("TDD Mandatory");
    expect(output).toContain("TypeScript Rules");
  });

  it("includes hooks summary", () => {
    const config: HarnessConfig = {
      version: "1.0",
      project: {
        stacks: [{ name: "app", framework: "react", language: "typescript" }],
      },
      rules: [],
      enforcement: { preCommit: [], blockedPaths: [], blockedCommands: [], postSave: [] },
      hooks: [
        { block: "commit-test-gate", params: { testCommand: "npx vitest run" } },
        { block: "path-guard", params: { blockedPaths: ["dist/", "node_modules/"] } },
        { block: "lint-on-save", params: { filePattern: "*.ts", command: "eslint --fix" } },
      ],
      permissions: { allow: [], deny: [] },
    };
    const output = formatConfigSummary(config);
    expect(output).toContain("commit-test-gate");
    expect(output).toContain("path-guard");
    expect(output).toContain("lint-on-save");
  });

  it("shows enforcement-derived hooks when enforcement is present", () => {
    const config: HarnessConfig = {
      version: "1.0",
      project: {
        stacks: [{ name: "app", framework: "react", language: "typescript" }],
      },
      rules: [],
      enforcement: {
        preCommit: ["npx vitest run", "npx tsc --noEmit"],
        blockedPaths: ["dist/", "node_modules/"],
        blockedCommands: [],
        postSave: [{ pattern: "*.ts", command: "eslint --fix" }],
      },
      hooks: [],
      permissions: { allow: [], deny: [] },
    };
    const output = formatConfigSummary(config);
    // enforcement is auto-converted to hooks for display
    expect(output).toContain("commit-test-gate");
    expect(output).toContain("commit-typecheck-gate");
    expect(output).toContain("path-guard");
    expect(output).toContain("lint-on-save");
  });

  it("handles config with no hooks and no enforcement", () => {
    const config: HarnessConfig = {
      version: "1.0",
      project: {
        stacks: [{ name: "app", framework: "react", language: "typescript" }],
      },
      rules: [],
      enforcement: { preCommit: [], blockedPaths: [], blockedCommands: [], postSave: [] },
      hooks: [],
      permissions: { allow: [], deny: [] },
    };
    const output = formatConfigSummary(config);
    expect(typeof output).toBe("string");
  });
});

describe("buildPresetExtends", () => {
  it("returns language-only preset when no framework and no PM", () => {
    const result = buildPresetExtends("rust", undefined, undefined);
    expect(result).toEqual(["_base", "rust"]);
  });

  it("includes framework when not 'none'", () => {
    const result = buildPresetExtends("python", "django", undefined);
    expect(result).toEqual(["_base", "python", "django"]);
  });

  it("excludes framework when value is 'none'", () => {
    const result = buildPresetExtends("python", "none", "uv");
    expect(result).toEqual(["_base", "python", "uv"]);
  });

  it("includes package manager when provided", () => {
    const result = buildPresetExtends("typescript", "nextjs", "pnpm");
    expect(result).toEqual(["_base", "typescript", "nextjs", "pnpm"]);
  });

  it("handles language with no framework and a PM", () => {
    const result = buildPresetExtends("java", undefined, "gradle");
    expect(result).toEqual(["_base", "java", "gradle"]);
  });
});

describe("formatProjectFacts", () => {
  it("displays detected languages and frameworks", () => {
    const facts = {
      ...emptyFacts(),
      languages: ["typescript"],
      frameworks: ["nextjs"],
      packageManagers: ["pnpm"],
      testCommands: ["pnpm test"],
      lintCommands: ["eslint --fix"],
    };
    const output = formatProjectFacts(facts);
    expect(output).toContain("typescript");
    expect(output).toContain("nextjs");
    expect(output).toContain("pnpm");
    expect(output).toContain("pnpm test");
    expect(output).toContain("eslint --fix");
  });

  it("omits empty fields", () => {
    const facts = {
      ...emptyFacts(),
      languages: ["go"],
      testCommands: ["go test ./..."],
    };
    const output = formatProjectFacts(facts);
    expect(output).toContain("go");
    expect(output).toContain("go test ./...");
    expect(output).not.toContain("Frameworks");
    expect(output).not.toContain("Package managers");
  });

  it("shows fallback message for empty facts", () => {
    const output = formatProjectFacts(emptyFacts());
    expect(output).toContain("No project signals detected");
  });
});

describe("NL mode provider integration", () => {
  it("init-flow imports createDefaultRunner from parse-intent", async () => {
    const mod = await import("../../src/nl/parse-intent.js");
    expect(typeof mod.createDefaultRunner).toBe("function");
  });

  it("init-flow imports hasProviderConfig from config-store", async () => {
    const mod = await import("../../src/nl/config-store.js");
    expect(typeof mod.hasProviderConfig).toBe("function");
  });

  it("uses configured provider runner when generating harness in NL mode", async () => {
    const promptMock = {
      intro: vi.fn(),
      note: vi.fn(),
      outro: vi.fn(),
      cancel: vi.fn(),
      isCancel: vi.fn(() => false),
      spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
      log: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
      },
      select: vi.fn(async () => "nl"),
      text: vi.fn(async () => "build app"),
      confirm: vi.fn(async () => true),
      multiselect: vi.fn(async () => []),
    };

    const mockLoadProviderConfig = vi.fn(async () => ({
      provider: "openai" as const,
      method: "api" as const,
      apiKey: "sk-test-key",
      model: "gpt-4o",
    }));
    const mockHasProviderConfig = vi.fn(async () => true);
    const mockGenerateHarnessConfig = vi.fn(async () => ({
      version: "1.0",
      project: {
        name: "test-app",
        stacks: [{ name: "frontend", framework: "nextjs", language: "typescript" }],
      },
      rules: [],
      enforcement: { preCommit: [], blockedPaths: [], blockedCommands: [], postSave: [] },
      hooks: [],
      permissions: { allow: [], deny: [] },
    }));
    const createDefaultRunnerSpy = vi.fn();

    vi.resetModules();
    vi.doMock("@clack/prompts", () => promptMock);
    vi.doMock("../../src/cli/deps-checker.js", () => ({
      checkDependencies: vi.fn(async () => [
        {
          name: "claude",
          command: "claude --version",
          required: false,
          purpose: "AI mode",
          installHint: "install claude",
          installed: true,
        },
      ]),
    }));
    vi.doMock("../../src/cli/tool-checker.js", () => ({
      checkReferencedTools: vi.fn(async () => []),
    }));
    vi.doMock("../../src/detector/project-detector.js", () => ({
      detectProject: vi.fn(async () => emptyFacts()),
    }));
    vi.doMock("../../src/nl/config-store.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src/nl/config-store.js")>();
      return {
        ...actual,
        hasProviderConfig: mockHasProviderConfig,
        loadProviderConfig: mockLoadProviderConfig,
      };
    });
    vi.doMock("../../src/nl/parse-intent.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src/nl/parse-intent.js")>();
      createDefaultRunnerSpy.mockImplementation(actual.createDefaultRunner);
      return {
        ...actual,
        createDefaultRunner: createDefaultRunnerSpy,
        generateHarnessConfig: mockGenerateHarnessConfig,
      };
    });
    vi.doMock("../../src/core/generator.js", () => ({
      generate: vi.fn(async () => ({ files: [path.join(tmpDir, "CLAUDE.md")] })),
    }));
    vi.doMock("../../src/cli/commands/init.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src/cli/commands/init.js")>();
      return {
        ...actual,
        writeHarnessState: vi.fn(async () => undefined),
      };
    });
    vi.doMock("../../src/core/harness-converter-v2.js", () => ({
      harnessToMergedConfigV2: vi.fn(async () => ({
        presets: [],
        variables: {},
        claudeMdSections: [],
        hooks: {
          preToolUse: [],
          postToolUse: [],
          sessionStart: [],
          notification: [],
          configChange: [],
          worktreeCreate: [],
        },
        settings: { permissions: { allow: [], deny: [] } },
      })),
    }));
    vi.doMock("../../src/catalog/registry.js", () => ({
      createDefaultRegistry: vi.fn(async () => ({
        list: () => [],
      })),
    }));

    const { runInitTUI } = await import("../../src/cli/tui/init-flow.js");

    await runInitTUI({ projectDir: tmpDir, presetsDir: path.resolve(import.meta.dirname, "../../presets") });

    expect(createDefaultRunnerSpy).toHaveBeenCalledOnce();
    expect(mockHasProviderConfig).toHaveBeenCalledOnce();
    expect(mockLoadProviderConfig).toHaveBeenCalledOnce();
    expect(mockGenerateHarnessConfig).toHaveBeenCalledOnce();
  });
});
