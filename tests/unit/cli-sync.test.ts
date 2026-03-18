import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Mock generate
vi.mock("../../src/core/generator.js", () => ({
  generate: vi.fn(),
}));

// Mock harnessToMergedConfig and mergeEnforcementAndHooks
vi.mock("../../src/core/harness-converter.js", () => ({
  harnessToMergedConfig: vi.fn(),
  mergeEnforcementAndHooks: vi.fn().mockReturnValue([]),
}));

describe("syncCommand", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let tmpDir: string;

  beforeEach(async () => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-sync-test-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("reads harness.yaml and regenerates files", async () => {
    const { generate } = await import("../../src/core/generator.js");
    const { harnessToMergedConfig } = await import("../../src/core/harness-converter.js");

    const mockMergedConfig = { presets: ["harness"], variables: {}, claudeMdSections: [], hooks: { preToolUse: [], postToolUse: [] }, settings: { permissions: { allow: [], deny: [] } } };
    vi.mocked(harnessToMergedConfig).mockReturnValue(mockMergedConfig as ReturnType<typeof harnessToMergedConfig>);
    vi.mocked(generate).mockResolvedValue({ files: [`${tmpDir}/CLAUDE.md`, `${tmpDir}/.claude/settings.json`] });

    const harnessYaml = `
version: "1.0"
project:
  name: test-app
  stacks:
    - name: frontend
      framework: nextjs
      language: typescript
rules: []
enforcement:
  preCommit: []
  blockedPaths: []
  blockedCommands: []
  postSave: []
permissions:
  allow: []
  deny: []
`;
    await fs.writeFile(path.join(tmpDir, "harness.yaml"), harnessYaml, "utf-8");

    const { syncCommand } = await import("../../src/cli/commands/sync.js");
    await syncCommand({ projectDir: tmpDir });

    expect(harnessToMergedConfig).toHaveBeenCalled();
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ projectDir: tmpDir }));

    const output = consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("CLAUDE.md");
  });

  it("fails gracefully when harness.yaml is missing", async () => {
    const { syncCommand } = await import("../../src/cli/commands/sync.js");
    await syncCommand({ projectDir: tmpDir });

    const errorOutput = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errorOutput).toContain("harness.yaml");
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
