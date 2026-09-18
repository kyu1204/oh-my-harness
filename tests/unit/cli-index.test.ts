import { describe, it, expect } from "vitest";
import { createCli } from "../../src/cli/index.js";

describe("cli: init options", () => {
  it("exposes --preset <name> on init (#116)", () => {
    const init = createCli().commands.find((c) => c.name() === "init");
    expect(init).toBeDefined();
    const preset = init!.options.find((o) => o.long === "--preset");
    expect(preset).toBeDefined();
    expect(preset!.description).toMatch(/minimal.*safe.*strict/);
  });
});
