import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  appendEvent,
  readEvents,
  getSessionEvents,
  aggregateStats,
  type HookEvent,
} from "../../src/cli/event-logger.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "event-logger-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("appendEvent", () => {
  it("events.jsonl에 이벤트 한 줄 append, 디렉토리 자동 생성", async () => {
    const event: HookEvent = {
      ts: new Date().toISOString(),
      event: "PreToolUse",
      hook: "bash-guard",
      decision: "allow",
    };

    await appendEvent(tmpDir, event);

    const stateDir = path.join(tmpDir, ".claude/hooks/.state");
    const filePath = path.join(stateDir, "events.jsonl");
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(event);
  });

  it("여러 이벤트를 순서대로 append", async () => {
    const event1: HookEvent = {
      ts: "2024-01-01T00:00:00.000Z",
      event: "PreToolUse",
      hook: "bash-guard",
      decision: "block",
      reason: "dangerous command",
    };
    const event2: HookEvent = {
      ts: "2024-01-01T00:01:00.000Z",
      event: "PreToolUse",
      hook: "file-guard",
      decision: "allow",
      tool: "Write",
    };

    await appendEvent(tmpDir, event1);
    await appendEvent(tmpDir, event2);

    const events = await readEvents(tmpDir);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(event1);
    expect(events[1]).toEqual(event2);
  });
});

describe("readEvents", () => {
  it("jsonl 파싱하여 HookEvent[] 반환", async () => {
    const event: HookEvent = {
      ts: "2024-01-01T00:00:00.000Z",
      event: "PreToolUse",
      hook: "bash-guard",
      decision: "allow",
    };

    await appendEvent(tmpDir, event);
    const events = await readEvents(tmpDir);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(event);
  });

  it("파일 없을 때 빈 배열 반환", async () => {
    const events = await readEvents(tmpDir);
    expect(events).toEqual([]);
  });

  it("잘못된 JSON 줄 무시 (graceful)", async () => {
    const stateDir = path.join(tmpDir, ".claude/hooks/.state");
    await fs.mkdir(stateDir, { recursive: true });
    const filePath = path.join(stateDir, "events.jsonl");

    const validEvent: HookEvent = {
      ts: "2024-01-01T00:00:00.000Z",
      event: "PreToolUse",
      hook: "bash-guard",
      decision: "allow",
    };

    await fs.writeFile(
      filePath,
      [
        JSON.stringify(validEvent),
        "INVALID JSON {{{",
        JSON.stringify({ ...validEvent, hook: "file-guard" }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const events = await readEvents(tmpDir);
    expect(events).toHaveLength(2);
    expect(events[0].hook).toBe("bash-guard");
    expect(events[1].hook).toBe("file-guard");
  });

  it("필수 필드 누락된 JSON은 무시 (런타임 검증)", async () => {
    const stateDir = path.join(tmpDir, ".claude/hooks/.state");
    await fs.mkdir(stateDir, { recursive: true });
    const filePath = path.join(stateDir, "events.jsonl");

    await fs.writeFile(
      filePath,
      [
        '{"ts":"2024-01-01T00:00:00Z","event":"PreToolUse","hook":"guard","decision":"block"}',
        '{"ts":"2024-01-01T00:00:01Z","hook":"guard","decision":"allow"}',
        '{"random":"data"}',
        '{"ts":"2024-01-01T00:00:02Z","event":"PostToolUse","hook":"lint","decision":"allow"}',
      ].join("\n") + "\n",
      "utf-8",
    );

    const events = await readEvents(tmpDir);
    // 필수 필드(ts, event, hook, decision) 모두 있는 것만 반환
    // 2번째 줄은 event 필드 누락이므로 필터링됨
    expect(events).toHaveLength(2);
    expect(events.every(e => e.ts && e.event && e.hook && e.decision)).toBe(true);
  });
});

describe("getSessionEvents", () => {
  it("since 이후 이벤트만 필터링", async () => {
    const oldEvent: HookEvent = {
      ts: "2024-01-01T00:00:00.000Z",
      event: "PreToolUse",
      hook: "bash-guard",
      decision: "allow",
    };
    const newEvent: HookEvent = {
      ts: "2024-06-01T00:00:00.000Z",
      event: "PreToolUse",
      hook: "file-guard",
      decision: "block",
    };

    await appendEvent(tmpDir, oldEvent);
    await appendEvent(tmpDir, newEvent);

    const since = new Date("2024-03-01T00:00:00.000Z");
    const events = await getSessionEvents(tmpDir, since);

    expect(events).toHaveLength(1);
    expect(events[0].hook).toBe("file-guard");
  });

  it("since 없으면 전체 이벤트 반환", async () => {
    const event1: HookEvent = {
      ts: "2024-01-01T00:00:00.000Z",
      event: "PreToolUse",
      hook: "bash-guard",
      decision: "allow",
    };
    const event2: HookEvent = {
      ts: "2024-06-01T00:00:00.000Z",
      event: "PreToolUse",
      hook: "file-guard",
      decision: "block",
    };

    await appendEvent(tmpDir, event1);
    await appendEvent(tmpDir, event2);

    const events = await getSessionEvents(tmpDir);
    expect(events).toHaveLength(2);
  });
});

describe("aggregateStats", () => {
  it("hook별 block/allow 집계", () => {
    const events: HookEvent[] = [
      { ts: "2024-01-01T00:00:00.000Z", event: "PreToolUse", hook: "bash-guard", decision: "block" },
      { ts: "2024-01-01T00:01:00.000Z", event: "PreToolUse", hook: "bash-guard", decision: "allow" },
      { ts: "2024-01-01T00:02:00.000Z", event: "PreToolUse", hook: "bash-guard", decision: "block" },
      { ts: "2024-01-01T00:03:00.000Z", event: "PreToolUse", hook: "file-guard", decision: "allow" },
    ];

    const stats = aggregateStats(events);

    expect(stats.totalEvents).toBe(4);
    expect(stats.blockCount).toBe(2);
    expect(stats.allowCount).toBe(2);
    expect(stats.byHook["bash-guard"]).toEqual({ block: 2, allow: 1 });
    expect(stats.byHook["file-guard"]).toEqual({ block: 0, allow: 1 });
  });

  it("빈 배열이면 전부 0", () => {
    const stats = aggregateStats([]);

    expect(stats.totalEvents).toBe(0);
    expect(stats.blockCount).toBe(0);
    expect(stats.allowCount).toBe(0);
    expect(stats.byHook).toEqual({});
  });
});
