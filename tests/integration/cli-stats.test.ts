import { describe, it, expect } from "vitest";
import { createCli } from "../../src/cli/index.js";
import { statsCommand } from "../../src/cli/stats/index.js";

describe("omh stats CLI", () => {
  it("stats command is registered with description", () => {
    const program = createCli();
    const statsCmd = program.commands.find(c => c.name() === "stats");
    expect(statsCmd).toBeDefined();
    expect(statsCmd!.description()).toContain("dashboard");
  });

  it("exits gracefully with error message in non-TTY environment", async () => {
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = undefined as unknown as boolean;

    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await statsCommand();
    } catch {
      // should not throw
    }

    console.error = originalError;
    process.stdin.isTTY = originalIsTTY;

    expect(logs.some((l) => l.includes("TTY") || l.includes("terminal") || l.includes("interactive"))).toBe(true);
  });
});
