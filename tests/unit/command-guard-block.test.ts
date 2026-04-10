import { describe, it, expect } from "vitest";
import { commandGuard } from "../../src/catalog/blocks/command-guard.js";

describe("commandGuard block", () => {
  it("has correct metadata", () => {
    expect(commandGuard.id).toBe("command-guard");
    expect(commandGuard.event).toBe("PreToolUse");
    expect(commandGuard.matcher).toBe("Bash");
    expect(commandGuard.canBlock).toBe(true);
  });

  it("template uses grep -- to support patterns starting with dashes", () => {
    // Without --, patterns like --no-verify are interpreted as grep options
    expect(commandGuard.template).toContain('grep -qF -- ');
  });

  it("generated script normalizes all whitespace before pattern matching", () => {
    expect(commandGuard.template).toContain("tr '[:space:]' ' ' | tr -s ' '");
  });
});
