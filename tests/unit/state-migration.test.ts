import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { migrateLegacyState } from "../../src/utils/state-migration.js";

describe("migrateLegacyState", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-mig-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty report when legacy state directory does not exist", async () => {
    const report = await migrateLegacyState(tmpDir);
    expect(report.migrated).toEqual([]);
  });

  it("moves events.jsonl to .omh/state/events.jsonl", async () => {
    const legacyState = path.join(tmpDir, ".claude/hooks/.state");
    await fs.mkdir(legacyState, { recursive: true });
    const sample = '{"ts":"2026-01-01T00:00:00Z","event":"PreToolUse","hook":"x.sh","decision":"allow"}\n';
    await fs.writeFile(path.join(legacyState, "events.jsonl"), sample, "utf8");

    await migrateLegacyState(tmpDir);

    const moved = await fs.readFile(path.join(tmpDir, ".omh/state/events.jsonl"), "utf8");
    expect(moved).toContain('"hook":"x.sh"');
  });

  it("renames edit-history.json to tdd-edits.json", async () => {
    const legacyState = path.join(tmpDir, ".claude/hooks/.state");
    await fs.mkdir(legacyState, { recursive: true });
    await fs.writeFile(
      path.join(legacyState, "edit-history.json"),
      JSON.stringify({ edits: ["foo.test.ts"] }),
      "utf8",
    );

    await migrateLegacyState(tmpDir);

    const moved = await fs.readFile(path.join(tmpDir, ".omh/state/tdd-edits.json"), "utf8");
    expect(JSON.parse(moved)).toEqual({ edits: ["foo.test.ts"] });
  });

  it("absorbs config-audit.log into events.jsonl as ConfigChange events", async () => {
    const legacyState = path.join(tmpDir, ".claude/hooks/.state");
    await fs.mkdir(legacyState, { recursive: true });
    const audit =
      '{"ts":"2026-01-01T00:00:00Z","source":"user_settings","file":"/u/.claude/settings.json"}\n' +
      '{"ts":"2026-01-02T00:00:00Z","source":"skills","file":"/u/.claude/skills/x.md"}\n';
    await fs.writeFile(path.join(legacyState, "config-audit.log"), audit, "utf8");

    await migrateLegacyState(tmpDir);

    const events = await fs.readFile(path.join(tmpDir, ".omh/state/events.jsonl"), "utf8");
    const lines = events.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].event).toBe("ConfigChange");
    expect(lines[0].decision).toBe("allow");
    expect(lines[0].hook).toBe("catalog-config-audit.sh");
    expect(lines[0].meta).toEqual({ source: "user_settings", file: "/u/.claude/settings.json" });
    expect(lines[1].meta.source).toBe("skills");
  });

  it("does not overwrite an existing .omh/state/events.jsonl", async () => {
    const legacyState = path.join(tmpDir, ".claude/hooks/.state");
    const newState = path.join(tmpDir, ".omh/state");
    await fs.mkdir(legacyState, { recursive: true });
    await fs.mkdir(newState, { recursive: true });
    await fs.writeFile(path.join(legacyState, "events.jsonl"), "OLD\n", "utf8");
    await fs.writeFile(path.join(newState, "events.jsonl"), "NEW\n", "utf8");

    await migrateLegacyState(tmpDir);

    const content = await fs.readFile(path.join(newState, "events.jsonl"), "utf8");
    expect(content).toBe("NEW\n");
  });

  it("moves the manifest from .claude/hooks to .omh/manifest.json", async () => {
    await fs.mkdir(path.join(tmpDir, ".claude/hooks/.state"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".claude/hooks/oh-my-harness-manifest.json"),
      JSON.stringify({ generatedAt: "x", hooks: ["a.sh"] }),
      "utf8",
    );

    await migrateLegacyState(tmpDir);

    const manifest = JSON.parse(
      await fs.readFile(path.join(tmpDir, ".omh/manifest.json"), "utf8"),
    );
    expect(manifest.hooks).toEqual(["a.sh"]);
  });

  it("is idempotent: running twice does not duplicate events", async () => {
    const legacyState = path.join(tmpDir, ".claude/hooks/.state");
    await fs.mkdir(legacyState, { recursive: true });
    await fs.writeFile(
      path.join(legacyState, "config-audit.log"),
      '{"ts":"2026-01-01T00:00:00Z","source":"x","file":"y"}\n',
      "utf8",
    );

    await migrateLegacyState(tmpDir);
    // Second run: legacy log was unlinked → no-op
    await migrateLegacyState(tmpDir);

    const events = await fs.readFile(path.join(tmpDir, ".omh/state/events.jsonl"), "utf8");
    expect(events.trim().split("\n")).toHaveLength(1);
  });
});
