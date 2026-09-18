import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { explainCommand, formatExplanation, blockIdFromHook } from "../../src/cli/commands/explain.js";
import { builtinBlocks } from "../../src/catalog/blocks/index.js";

// #115: `omh explain` turns the last block decisions into plain language with
// the way to allow once and the way to change the rule. Each block owns its
// text (BuildingBlock.explain); the command only formats.

let dir: string;
let logs: string[];

async function writeEvents(lines: object[]) {
  await fs.mkdir(path.join(dir, ".omh", "state"), { recursive: true });
  await fs.writeFile(path.join(dir, ".omh", "state", "events.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-explain-"));
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("blockIdFromHook", () => {
  it("strips the catalog prefix and .sh", () => {
    expect(blockIdFromHook("catalog-tdd-guard.sh")).toBe("tdd-guard");
    expect(blockIdFromHook("harness-file-guard.sh")).toBe("file-guard");
    expect(blockIdFromHook("custom.sh")).toBe("custom");
  });
});

describe("every blocking catalog block explains itself", () => {
  it("has explain.change text, and allowOnce where a one-off is possible", () => {
    for (const b of builtinBlocks.filter((x) => x.canBlock)) {
      expect(b.explain?.change, b.id).toBeTruthy();
    }
    expect(builtinBlocks.find((b) => b.id === "tdd-guard")!.explain!.allowOnce).toMatch(/test/i);
  });
});

describe("formatExplanation", () => {
  it("renders when, which block, the reason, and the two remedies", () => {
    const out = formatExplanation(
      { ts: new Date(Date.now() - 120_000).toISOString(), event: "PreToolUse", hook: "catalog-tdd-guard.sh", decision: "block", reason: "oh-my-harness: TDD guard — edit the test for price first, then the source" },
      builtinBlocks,
      Date.now(),
    );
    expect(out).toMatch(/2 min ago/);
    expect(out).toMatch(/tdd-guard/);
    expect(out).toMatch(/edit the test for price first/);
    expect(out).toMatch(/To allow once:/);
    expect(out).toMatch(/To change the rule:/);
    expect(out).toMatch(/harness\.yaml/);
    expect(out).toMatch(/omh sync/);
  });

  it("falls back to a generic remedy for hooks that are not catalog blocks", () => {
    const out = formatExplanation({ ts: new Date().toISOString(), event: "PreToolUse", hook: "custom-thing.sh", decision: "block", reason: "nope" }, builtinBlocks, Date.now());
    expect(out).toMatch(/custom-thing/);
    expect(out).toMatch(/nope/);
    expect(out).toMatch(/\.claude\/settings\.json|harness\.yaml/);
  });
});

describe("explainCommand", () => {
  it("prints the last N blocks, newest first, and skips allows", async () => {
    const t = (s: number) => new Date(Date.now() - s * 1000).toISOString();
    await writeEvents([
      { ts: t(400), event: "PreToolUse", hook: "catalog-command-guard.sh", decision: "block", reason: "oh-my-harness: command matches blocked pattern: rm -rf /" },
      { ts: t(300), event: "PreToolUse", hook: "catalog-branch-guard.sh", decision: "allow", reason: "" },
      { ts: t(200), event: "PreToolUse", hook: "catalog-tdd-guard.sh", decision: "block", reason: "oh-my-harness: TDD guard — edit the test for x first, then the source" },
      { ts: t(100), event: "PreToolUse", hook: "catalog-lockfile-guard.sh", decision: "block", reason: "oh-my-harness: direct edits to lockfile package-lock.json are blocked." },
    ]);
    const result = await explainCommand({ projectDir: dir, last: 2 });
    expect(result.exitCode).toBe(0);
    const text = logs.join("\n");
    expect(text.indexOf("lockfile-guard")).toBeLessThan(text.indexOf("tdd-guard"));
    expect(text).not.toMatch(/command-guard/);
    expect(text).not.toMatch(/branch-guard/);
  });

  it("defaults to the last 5 and says so when there is nothing to explain", async () => {
    await writeEvents([{ ts: new Date().toISOString(), event: "PreToolUse", hook: "catalog-branch-guard.sh", decision: "allow", reason: "" }]);
    const result = await explainCommand({ projectDir: dir });
    expect(result.exitCode).toBe(0);
    expect(logs.join("\n")).toMatch(/No blocked tool calls/);
  });

  it("--json emits structured entries", async () => {
    await writeEvents([{ ts: new Date().toISOString(), event: "PreToolUse", hook: "catalog-tdd-guard.sh", decision: "block", reason: "r" }]);
    const result = await explainCommand({ projectDir: dir, json: true });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ block: "tdd-guard", reason: "r", allowOnce: expect.any(String), change: expect.any(String) });
  });

  it("reports a missing event log without failing", async () => {
    const result = await explainCommand({ projectDir: dir });
    expect(result.exitCode).toBe(0);
    expect(logs.join("\n")).toMatch(/No blocked tool calls/);
  });
});
