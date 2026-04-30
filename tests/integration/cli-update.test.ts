import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { updateCommand } from "../../src/cli/commands/update.js";

describe("updateCommand", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    logs = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    logSpy.mockRestore();
  });

  it("reports already up-to-date when versions match", async () => {
    const result = await updateCommand("0.10.2", {}, {
      fetchLatest: async () => "0.10.2",
      spawn: () => ({ status: 0 }),
    });
    expect(result.exitCode).toBe(0);
    expect(result.ran).toBe(false);
    expect(logs.join("\n")).toMatch(/up to date/i);
  });

  it("reports network failure gracefully when fetcher returns null", async () => {
    const result = await updateCommand("0.10.2", {}, {
      fetchLatest: async () => null,
      spawn: () => ({ status: 0 }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.ran).toBe(false);
  });

  it("dry-run prints command without spawning", async () => {
    let spawnCalled = false;
    const result = await updateCommand(
      "0.10.2",
      { dryRun: true },
      {
        fetchLatest: async () => "0.20.0",
        spawn: () => {
          spawnCalled = true;
          return { status: 0 };
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.ran).toBe(false);
    expect(spawnCalled).toBe(false);
    expect(result.command).toMatch(/oh-my-harness/);
  });

  it("--yes flag skips confirm and runs update", async () => {
    let capturedCmd: string | undefined;
    let capturedArgs: string[] | undefined;
    process.env.npm_config_user_agent = "npm/10.0.0 node/v20.0.0";
    const result = await updateCommand(
      "0.10.2",
      { yes: true },
      {
        fetchLatest: async () => "0.20.0",
        spawn: (cmd, args) => {
          capturedCmd = cmd;
          capturedArgs = args;
          return { status: 0 };
        },
      },
    );
    expect(result.ran).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(capturedCmd).toBe("npm");
    expect(capturedArgs).toEqual(["install", "-g", "oh-my-harness@latest"]);
  });

  it("propagates non-zero exit code from spawn failure", async () => {
    process.env.npm_config_user_agent = "npm/10.0.0 node/v20.0.0";
    const result = await updateCommand(
      "0.10.2",
      { yes: true },
      {
        fetchLatest: async () => "0.20.0",
        spawn: () => ({ status: 1 }),
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.ran).toBe(true);
  });

  it("npx environment skips spawn — prints global install hint", async () => {
    process.env.npm_config_user_agent =
      "npm/10.0.0 npx-cli/10.0.0 node/v20.0.0";
    let spawnCalled = false;
    const result = await updateCommand(
      "0.10.2",
      { yes: true },
      {
        fetchLatest: async () => "0.20.0",
        spawn: () => {
          spawnCalled = true;
          return { status: 0 };
        },
      },
    );
    expect(result.ran).toBe(false);
    expect(spawnCalled).toBe(false);
    expect(logs.join("\n")).toMatch(/global/i);
  });
});
