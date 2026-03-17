import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { catalogListCommand, catalogInfoCommand } from "../../src/cli/commands/catalog.js";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("catalogListCommand", () => {
  it("lists all built-in blocks without throwing", async () => {
    await expect(catalogListCommand()).resolves.toBeUndefined();
  });

  it("outputs block ids to console", async () => {
    const logSpy = vi.spyOn(console, "log");

    await catalogListCommand();

    const output = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    // branch-guard is a known built-in block
    expect(output).toContain("branch-guard");
  });

  it("outputs multiple blocks from different categories", async () => {
    const logSpy = vi.spyOn(console, "log");

    await catalogListCommand();

    const output = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    // Verify blocks from different categories are present
    expect(output).toContain("branch-guard");
    expect(output).toContain("commit-test-gate");
  });
});

describe("catalogInfoCommand", () => {
  it("prints detailed info for branch-guard", async () => {
    const logSpy = vi.spyOn(console, "log");

    await catalogInfoCommand("branch-guard");

    const output = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(output).toContain("branch-guard");
    expect(output).toContain("Branch Guard");
  });

  it("prints category and event for branch-guard", async () => {
    const logSpy = vi.spyOn(console, "log");

    await catalogInfoCommand("branch-guard");

    const output = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(output).toContain("git");
    expect(output).toContain("PreToolUse");
  });

  it("prints parameter details for branch-guard", async () => {
    const logSpy = vi.spyOn(console, "log");

    await catalogInfoCommand("branch-guard");

    const output = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    // branch-guard has a mainBranch param
    expect(output).toContain("mainBranch");
  });

  it("calls process.exit(1) for a nonexistent block", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number | string) => {
      throw new Error("process.exit called");
    });

    await expect(catalogInfoCommand("nonexistent-block-xyz")).rejects.toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("prints error message for a nonexistent block", async () => {
    vi.spyOn(process, "exit").mockImplementation((_code?: number | string) => {
      throw new Error("process.exit called");
    });
    const errorSpy = vi.spyOn(console, "error");

    await expect(catalogInfoCommand("nonexistent-block-xyz")).rejects.toThrow();

    const errorOutput = errorSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(errorOutput).toContain("nonexistent-block-xyz");
  });
});
