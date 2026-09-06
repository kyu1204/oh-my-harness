import { describe, it, expect } from "vitest";
import { commandGuard } from "../../src/catalog/blocks/command-guard.js";

describe("commandGuard block", () => {
  it("has correct metadata", () => {
    expect(commandGuard.id).toBe("command-guard");
    expect(commandGuard.event).toBe("PreToolUse");
    expect(commandGuard.matcher).toBe("Bash");
    expect(commandGuard.canBlock).toBe(true);
  });

  it("template matches patterns through the shared shell-token helper, not raw grep (#109)", () => {
    // Token matching handles dash-leading patterns (--no-verify) and any
    // whitespace shape; quoted text never matches. Behaviour is covered in
    // tests/integration/command-parser.test.ts and catalog-block-execution.test.ts.
    expect(commandGuard.template).toContain('_omh_cmd_has_pattern "$COMMAND" "$PATTERN"');
    expect(commandGuard.template).not.toContain("grep");
  });
});
