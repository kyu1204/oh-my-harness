import { describe, it, expect } from "vitest";
import { createCli } from "../../src/cli/index.js";

describe("omh stats CLI", () => {
  it("stats command is registered with description", () => {
    const program = createCli();
    const statsCmd = program.commands.find(c => c.name() === "stats");
    expect(statsCmd).toBeDefined();
    expect(statsCmd!.description()).toContain("dashboard");
  });
});
