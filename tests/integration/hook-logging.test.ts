import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { wrapWithLogger } from "../../src/generators/hooks.js";
import { readEvents } from "../../src/cli/event-logger.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "hook-logging-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function runHookScript(scriptPath: string, stdin: string): string {
  try {
    return execSync(`bash "${scriptPath}"`, {
      input: stdin,
      cwd: tmpDir,
      encoding: "utf-8",
      timeout: 5000,
    });
  } catch (e) {
    // Script may exit non-zero but still produce output
    return (e as { stdout?: string }).stdout ?? "";
  }
}

describe("hook logging integration", () => {
  it("allow hook writes correct event to events.jsonl", async () => {
    const script = wrapWithLogger(
      "#!/bin/bash\nset -euo pipefail\nINPUT=$(cat)\nexit 0",
      "PreToolUse",
    );
    const scriptPath = join(tmpDir, "test-hook.sh");
    await writeFile(scriptPath, script, { mode: 0o755 });

    runHookScript(scriptPath, '{"tool_name":"Bash"}');

    const events = await readEvents(tmpDir);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].event).toBe("PreToolUse");
    expect(events[0].decision).toBe("allow");
    expect(events[0].hook).toBe("test-hook.sh");
  });

  it("event field reflects the hook event type (PostToolUse)", async () => {
    const script = wrapWithLogger(
      "#!/bin/bash\nset -euo pipefail\nINPUT=$(cat)\nexit 0",
      "PostToolUse",
    );
    const scriptPath = join(tmpDir, "post-hook.sh");
    await writeFile(scriptPath, script, { mode: 0o755 });

    runHookScript(scriptPath, '{"tool_name":"Bash"}');

    const events = await readEvents(tmpDir);
    expect(events[0].event).toBe("PostToolUse");
  });

  it("block hook logs decision as block with reason", async () => {
    // Simulate a blocking hook that outputs block JSON
    const blockScript = `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
_log_event "block" "dangerous command"
echo '{"decision": "block", "reason": "dangerous command"}'
exit 0`;

    const script = wrapWithLogger(blockScript, "PreToolUse");
    const scriptPath = join(tmpDir, "block-hook.sh");
    await writeFile(scriptPath, script, { mode: 0o755 });

    const stdout = runHookScript(scriptPath, '{"tool_name":"Bash"}');

    const events = await readEvents(tmpDir);
    expect(events.length).toBeGreaterThanOrEqual(1);

    const blockEvent = events.find((e) => e.decision === "block");
    expect(blockEvent).toBeDefined();
    expect(blockEvent!.decision).toBe("block");
    expect(blockEvent!.reason).toBe("dangerous command");
    expect(blockEvent!.event).toBe("PreToolUse");

    // Should not also log an "allow" event
    const allowEvents = events.filter((e) => e.decision === "allow");
    expect(allowEvents).toHaveLength(0);
  });

  it("events.jsonl output is parseable by readEvents", async () => {
    const script = wrapWithLogger(
      "#!/bin/bash\nset -euo pipefail\nINPUT=$(cat)\nexit 0",
      "PreToolUse",
    );
    const scriptPath = join(tmpDir, "compat-hook.sh");
    await writeFile(scriptPath, script, { mode: 0o755 });

    runHookScript(scriptPath, '{"tool_name":"Bash"}');

    // Verify raw JSONL is valid and has all required fields
    const eventsFile = join(tmpDir, ".omh/state/events.jsonl");
    const raw = await readFile(eventsFile, "utf-8");
    const parsed = JSON.parse(raw.trim());

    expect(parsed).toHaveProperty("ts");
    expect(parsed).toHaveProperty("event");
    expect(parsed).toHaveProperty("hook");
    expect(parsed).toHaveProperty("decision");
    expect(typeof parsed.event).toBe("string");
    expect(parsed.event).not.toBe("unknown");
  });
});
