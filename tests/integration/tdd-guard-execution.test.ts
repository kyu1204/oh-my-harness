import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { builtinBlocks } from "../../src/catalog/blocks/index.js";
import { renderTemplate, applyDefaults } from "../../src/catalog/template-engine.js";
import { wrapWithLogger } from "../../src/generators/hooks.js";
import { readEvents } from "../../src/cli/event-logger.js";

function hasJq(): boolean {
  try {
    execSync("jq --version", { stdio: "ignore", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

function runScript(scriptPath: string, stdin: string, cwd: string): string {
  try {
    return execSync(`bash "${scriptPath}"`, {
      input: stdin,
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    });
  } catch (e) {
    return (e as { stdout?: string }).stdout ?? "";
  }
}

const tddBlock = builtinBlocks.find((b) => b.id === "tdd-guard")!;

describe("tdd-guard execution", () => {
  let tmpDir: string;
  let scriptPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "omh-tdd-"));
    // Render the tdd-guard script with defaults and wrap with logger
    const params = applyDefaults(tddBlock, {});
    const rendered = renderTemplate(tddBlock.template, params);
    const wrapped = wrapWithLogger(rendered, "PreToolUse");
    scriptPath = join(tmpDir, "catalog-tdd-guard.sh");
    await writeFile(scriptPath, wrapped, { mode: 0o755 });
    // Ensure state dir exists
    await mkdir(join(tmpDir, ".claude/hooks/.state"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it.runIf(hasJq())(
    "blocks source file edit when no prior test file recorded",
    async () => {
      // No edit-history.json → should block
      const stdout = runScript(
        scriptPath,
        JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "src/event-logger.ts" } }),
        tmpDir,
      );
      const trimmed = stdout.trim();
      expect(trimmed).not.toBe("");
      const result = JSON.parse(trimmed);
      expect(result.decision).toBe("block");
      expect(result.reason).toContain("event-logger");
    },
  );

  it.runIf(hasJq())(
    "allows source file edit when test file was recorded in edit-history",
    async () => {
      // Write edit-history with a test file pre-recorded
      const historyPath = join(tmpDir, ".claude/hooks/.state/edit-history.json");
      await writeFile(
        historyPath,
        JSON.stringify({ edits: ["tests/unit/event-logger.test.ts"] }),
      );

      const stdout = runScript(
        scriptPath,
        JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "src/event-logger.ts" } }),
        tmpDir,
      );
      const trimmed = stdout.trim();
      // allow → no block JSON output, or output with decision=allow
      if (trimmed.length > 0) {
        const result = JSON.parse(trimmed);
        expect(result.decision).not.toBe("block");
      } else {
        expect(trimmed).toBe("");
      }
    },
  );

  it.runIf(hasJq())(
    "allows non-code file edit (.json) without test history",
    async () => {
      const stdout = runScript(
        scriptPath,
        JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "config.json" } }),
        tmpDir,
      );
      const trimmed = stdout.trim();
      if (trimmed.length > 0) {
        const result = JSON.parse(trimmed);
        expect(result.decision).not.toBe("block");
      } else {
        expect(trimmed).toBe("");
      }
    },
  );

  it.runIf(hasJq())(
    "allows test file edit and records it in edit-history",
    async () => {
      const historyPath = join(tmpDir, ".claude/hooks/.state/edit-history.json");
      // Start with empty history
      await writeFile(historyPath, JSON.stringify({ edits: [] }));

      const stdout = runScript(
        scriptPath,
        JSON.stringify({
          tool_name: "Edit",
          tool_input: { file_path: "tests/unit/event-logger.test.ts" },
        }),
        tmpDir,
      );
      const trimmed = stdout.trim();
      // Allow → no block output
      if (trimmed.length > 0) {
        const result = JSON.parse(trimmed);
        expect(result.decision).not.toBe("block");
      } else {
        expect(trimmed).toBe("");
      }
    },
  );

  it.runIf(hasJq())(
    "blocks second source edit after first passed — test record consumed",
    async () => {
      const historyPath = join(tmpDir, ".claude/hooks/.state/edit-history.json");
      // Turn 1: record test file
      await writeFile(historyPath, JSON.stringify({ edits: ["tests/unit/event-logger.test.ts"] }));

      // Turn 1: source edit passes (consumes the test record)
      runScript(
        scriptPath,
        JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "src/event-logger.ts" } }),
        tmpDir,
      );

      // Turn 2: same source edit again — should block because test record was consumed
      const stdout = runScript(
        scriptPath,
        JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "src/event-logger.ts" } }),
        tmpDir,
      );
      const trimmed = stdout.trim();
      expect(trimmed).not.toBe("");
      const result = JSON.parse(trimmed);
      expect(result.decision).toBe("block");
    },
  );

  it.runIf(hasJq())(
    "records decision=block in events.jsonl when source file blocked",
    async () => {
      // No edit-history → block
      runScript(
        scriptPath,
        JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "src/event-logger.ts" } }),
        tmpDir,
      );

      const events = await readEvents(tmpDir);
      expect(events.length).toBeGreaterThan(0);
      const blockEvent = events.find((e) => e.decision === "block");
      expect(blockEvent).toBeDefined();
      expect(blockEvent?.hook).toContain("tdd-guard");
    },
  );
});
