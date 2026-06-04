import { describe, it, expect } from "vitest";
import { createCli } from "../../src/cli/index.js";
import type { Command } from "commander";

function find(program: Command, name: string): Command | undefined {
  return program.commands.find((c) => c.name() === name);
}

function hasOption(cmd: Command | undefined, long: string): boolean {
  return !!cmd && cmd.options.some((o) => o.long === long);
}

describe("createCli wiring", () => {
  const program = createCli();

  it("registers the diff command", () => {
    expect(find(program, "diff")).toBeDefined();
  });

  it("exposes --check on the sync command", () => {
    // --check powers the CI drift gate (sync --check exits non-zero on drift).
    expect(hasOption(find(program, "sync"), "--check")).toBe(true);
  });

  it("exposes --strict on the doctor command", () => {
    expect(hasOption(find(program, "doctor"), "--strict")).toBe(true);
  });

  it("registers uninstall with safety options", () => {
    const uninstall = find(program, "uninstall");
    expect(uninstall).toBeDefined();
    expect(hasOption(uninstall, "--dry-run")).toBe(true);
    expect(hasOption(uninstall, "--yes")).toBe(true);
    expect(hasOption(uninstall, "--purge")).toBe(true);
    expect(hasOption(uninstall, "--skip-backup-warning")).toBe(true);
    expect(hasOption(uninstall, "--continue-on-error")).toBe(true);
  });

  it("still registers the existing core commands", () => {
    for (const name of ["init", "sync", "doctor", "test", "stats", "uninstall"]) {
      expect(find(program, name)).toBeDefined();
    }
  });
});
