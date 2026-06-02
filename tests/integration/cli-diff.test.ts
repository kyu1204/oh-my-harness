import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncCommand } from "../../src/cli/commands/sync.js";
import { diffCommand } from "../../src/cli/commands/diff.js";

let projectDir: string;

const HARNESS = `version: "1.0"
hooks:
  - block: command-guard
    params:
      patterns:
        - "FOO"
`;
const HARNESS_DRIFTED = `version: "1.0"
hooks:
  - block: command-guard
    params:
      patterns:
        - "FOO"
        - "BAR"
`;

function captureStdout(): { output: () => string; restore: () => void } {
  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => { lines.push(a.join(" ")); });
  const err = vi.spyOn(console, "error").mockImplementation((...a) => { lines.push(a.join(" ")); });
  return {
    output: () => lines.join("\n"),
    restore: () => { log.mockRestore(); err.mockRestore(); },
  };
}

async function withCapturedStdout<T>(action: () => Promise<T>): Promise<{ result: T; output: string }> {
  const cap = captureStdout();
  try {
    const result = await action();
    return { result, output: cap.output() };
  } finally {
    cap.restore();
  }
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "omh-diff-"));
});
afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("diffCommand", () => {
  it("reports no changes when the project is in sync", async () => {
    await writeFile(join(projectDir, "harness.yaml"), HARNESS, "utf-8");
    await syncCommand({ projectDir });

    const { result, output } = await withCapturedStdout(() => diffCommand({ projectDir }));

    expect(result?.exitCode).toBe(0);
    expect(output.toLowerCase()).toContain("no changes");
  });

  it("shows the added line for a drifted hook script", async () => {
    await writeFile(join(projectDir, "harness.yaml"), HARNESS, "utf-8");
    await syncCommand({ projectDir });
    await writeFile(join(projectDir, "harness.yaml"), HARNESS_DRIFTED, "utf-8");

    const { output: out } = await withCapturedStdout(() => diffCommand({ projectDir }));
    expect(out).toContain("catalog-command-guard.sh");
    // The new "BAR" pattern should appear as an added (+) line.
    expect(out).toMatch(/\+.*BAR/);
  });

  it("does not write any files", async () => {
    await writeFile(join(projectDir, "harness.yaml"), HARNESS, "utf-8");
    await syncCommand({ projectDir });
    const scriptPath = join(projectDir, ".omh", "hooks", "catalog-command-guard.sh");
    const before = await readFile(scriptPath, "utf-8");

    await writeFile(join(projectDir, "harness.yaml"), HARNESS_DRIFTED, "utf-8");
    await withCapturedStdout(() => diffCommand({ projectDir }));

    const after = await readFile(scriptPath, "utf-8");
    expect(after).toBe(before);
  });
});
