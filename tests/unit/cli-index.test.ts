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

describe("cli: init error handling (QA)", () => {
  it("prints a one-line error and sets exit code 1 for an unknown preset", async () => {
    const { vi } = await import("vitest");
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a.join(" ")); });
    const before = process.exitCode;
    try {
      await createCli().parseAsync(["node", "omh", "init", "--preset", "yolo", "-y"]);
      expect(errors.join("\n")).toMatch(/Unknown preset "yolo".*minimal, safe, strict/);
      expect(errors.join("\n")).not.toMatch(/at .*\.js:\d+/);
      expect(process.exitCode).toBe(1);
    } finally {
      spy.mockRestore();
      process.exitCode = before;
    }
  });
});
