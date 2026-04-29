import { describe, it, expect } from "vitest";

import { sqlGuard } from "../../src/catalog/blocks/sql-guard.js";

describe("sqlGuard block", () => {
  it("has correct metadata", () => {
    expect(sqlGuard.id).toBe("sql-guard");
    expect(sqlGuard.event).toBe("PreToolUse");
    expect(sqlGuard.matcher).toBe("Bash");
    expect(sqlGuard.canBlock).toBe(true);
  });

  it("has patterns param with string[] type and defaults", () => {
    const patternsParam = sqlGuard.params.find((p) => p.name === "patterns");
    expect(patternsParam).toBeDefined();
    expect(patternsParam!.type).toBe("string[]");
    expect(patternsParam!.default).toEqual([
      "DROP TABLE",
      "DROP DATABASE",
      "TRUNCATE TABLE",
      "DELETE FROM",
      "DROP COLUMN",
      "DROP INDEX",
    ]);
  });

  it("template uses triple-stash for params", () => {
    expect(sqlGuard.template).toContain("{{{this}}}");
  });

  it("template uses grep -- for dash-prefix pattern support", () => {
    expect(sqlGuard.template).toContain("grep -qF -- ");
  });

  it("template performs case-insensitive matching", () => {
    expect(sqlGuard.template).toContain("tr '[:upper:]' '[:lower:]'");
  });

  it("logs the block via _log_event for omh stats parity with other guards", () => {
    // sql-guard previously omitted _log_event so its blocks were invisible
    // in events.jsonl / omh stats. Now consistent with all other guards.
    expect(sqlGuard.template).toContain('_log_event "block" "$REASON"');
    expect(sqlGuard.template).toContain('_emit_decision "block" "$REASON"');
  });
});
