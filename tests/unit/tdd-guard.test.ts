import { describe, it, expect } from "vitest";
import { tddGuard } from "../../src/catalog/blocks/tdd-guard.js";

describe("tddGuard block", () => {
  it("has correct metadata (id, event, matcher, canBlock)", () => {
    expect(tddGuard.id).toBe("tdd-guard");
    expect(tddGuard.event).toBe("PreToolUse");
    expect(tddGuard.matcher).toBe("Edit|Write");
    expect(tddGuard.canBlock).toBe(true);
  });

  it("has name and description", () => {
    expect(tddGuard.name).toBeTruthy();
    expect(tddGuard.description).toBeTruthy();
  });

  it("has workflow category", () => {
    expect(tddGuard.category).toBe("quality");
  });

  it("has tdd-related tags", () => {
    expect(tddGuard.tags).toContain("tdd");
    expect(tddGuard.tags.length).toBeGreaterThan(0);
  });

  it("template is a bash script", () => {
    expect(tddGuard.template).toContain("#!/bin/bash");
    expect(tddGuard.template).toContain("INPUT=$(cat)");
  });

  it("template matches test files by basename substring (e.g. node → node-detector.test.ts)", () => {
    // The edit-history search should match test files that contain the basename
    // not just exact basename.test. pattern
    expect(tddGuard.template).toContain("contains($b)");
  });

  it("template uses [[ =~ ]] instead of echo|grep for set -e pipefail safety", () => {
    // echo|grep with set -euo pipefail causes early exit on grep failure
    expect(tddGuard.template).not.toContain("echo | grep");
    expect(tddGuard.template).toContain("=~");
  });

  it("template contains edit-history logic", () => {
    expect(tddGuard.template).toContain("edit-history");
  });

  it("template allows .test.ts files to pass through", () => {
    expect(tddGuard.template).toMatch(/\.test\.|\.spec\./);
  });

  it("template allows non-code files to pass through", () => {
    expect(tddGuard.template).toMatch(/\.json|\.yaml|\.yml|\.md/);
  });

  it("template blocks source files without prior test edit", () => {
    expect(tddGuard.template).toMatch(/decision.*block|block.*decision/);
  });

  it("params include srcPattern and testPattern", () => {
    const paramNames = tddGuard.params.map((p) => p.name);
    expect(paramNames).toContain("srcPattern");
    expect(paramNames).toContain("testPattern");
  });

  it("params are properly defined with type and description", () => {
    for (const param of tddGuard.params) {
      expect(param.name).toBeTruthy();
      expect(param.type).toBeTruthy();
      expect(param.description).toBeTruthy();
    }
  });

  it("template uses testPattern and srcPattern params via Handlebars", () => {
    expect(tddGuard.template).toContain("{{testPattern}}");
    expect(tddGuard.template).toContain("{{srcPattern}}");
  });

  it("generated script uses flock for atomic read-write", () => {
    // Two concurrent hook processes must not overwrite each other's writes.
    // The script must use flock (file locking) around the jq read/write operations.
    expect(tddGuard.template).toMatch(/flock/);
    // The lock file descriptor redirect pattern: 200> or similar fd redirect
    expect(tddGuard.template).toMatch(/\d+>.*\.lock/);
  });
});
