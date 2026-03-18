import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getEventSnapshot, verifyEventLogged } from "../../src/cli/event-verifier.js";
// updated: strict hook name matching to prevent false positives
import { appendEvent, type HookEvent } from "../../src/cli/event-logger.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "event-verifier-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("getEventSnapshot", () => {
  it("returns 0 when no events file exists", async () => {
    const count = await getEventSnapshot(tmpDir);
    expect(count).toBe(0);
  });

  it("returns event count from existing events", async () => {
    const event: HookEvent = {
      ts: new Date().toISOString(),
      event: "PreToolUse",
      hook: "test-hook.sh",
      decision: "allow",
    };
    await appendEvent(tmpDir, event);
    await appendEvent(tmpDir, event);
    const count = await getEventSnapshot(tmpDir);
    expect(count).toBe(2);
  });
});

describe("verifyEventLogged", () => {
  it("returns verified=true when matching event is found", async () => {
    const snapshot = await getEventSnapshot(tmpDir);
    await appendEvent(tmpDir, {
      ts: new Date().toISOString(),
      event: "PreToolUse",
      hook: "catalog-command-guard.sh",
      decision: "block",
      reason: "dangerous",
    });
    const result = await verifyEventLogged(tmpDir, snapshot, "command-guard", "block");
    expect(result.verified).toBe(true);
    expect(result.matchedEvent?.decision).toBe("block");
  });

  it("returns verified=false when no new events", async () => {
    const snapshot = await getEventSnapshot(tmpDir);
    const result = await verifyEventLogged(tmpDir, snapshot, "command-guard", "block");
    expect(result.verified).toBe(false);
    expect(result.warning).toContain("No new events");
  });

  it("returns verified=false when hook not found in new events", async () => {
    const snapshot = await getEventSnapshot(tmpDir);
    await appendEvent(tmpDir, {
      ts: new Date().toISOString(),
      event: "PreToolUse",
      hook: "other-hook.sh",
      decision: "allow",
    });
    const result = await verifyEventLogged(tmpDir, snapshot, "command-guard", "block");
    expect(result.verified).toBe(false);
    expect(result.warning).toContain("No event found");
  });

  it("returns verified=false when decision mismatch", async () => {
    const snapshot = await getEventSnapshot(tmpDir);
    await appendEvent(tmpDir, {
      ts: new Date().toISOString(),
      event: "PreToolUse",
      hook: "catalog-command-guard.sh",
      decision: "allow",
    });
    const result = await verifyEventLogged(tmpDir, snapshot, "command-guard", "block");
    expect(result.verified).toBe(false);
    expect(result.warning).toContain("decision=");
  });

  it("matches hook names with catalog- prefix", async () => {
    const snapshot = await getEventSnapshot(tmpDir);
    await appendEvent(tmpDir, {
      ts: new Date().toISOString(),
      event: "PreToolUse",
      hook: "catalog-path-guard.sh",
      decision: "block",
    });
    const result = await verifyEventLogged(tmpDir, snapshot, "path-guard", "block");
    expect(result.verified).toBe(true);
  });

  it("ignores events before snapshot", async () => {
    await appendEvent(tmpDir, {
      ts: new Date().toISOString(),
      event: "PreToolUse",
      hook: "catalog-command-guard.sh",
      decision: "block",
    });
    const snapshot = await getEventSnapshot(tmpDir);
    // No new events after snapshot
    const result = await verifyEventLogged(tmpDir, snapshot, "command-guard", "block");
    expect(result.verified).toBe(false);
  });
});
