import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { HookEvent } from "../../src/cli/event-logger.js";
import type { BuildingBlock, HookEntry } from "../../src/catalog/types.js";
import {
  getActiveBlocks,
  getDormantBlocks,
  getHourlyDistribution,
  getDateFilteredEvents,
  getBlockDetail,
  loadStatsData,
} from "../../src/cli/stats/data.js";

// helpers
function makeEvent(overrides: Partial<HookEvent> & { ts: string; hook: string; decision: "block" | "allow" }): HookEvent {
  return {
    event: "PreToolUse",
    reason: undefined,
    tool: undefined,
    ...overrides,
  };
}

const mockBlock: BuildingBlock = {
  id: "command-guard",
  name: "Command Guard",
  description: "Blocks dangerous commands",
  category: "security",
  event: "PreToolUse",
  canBlock: true,
  params: [],
  template: "",
  tags: [],
};

const mockBlock2: BuildingBlock = {
  id: "branch-guard",
  name: "Branch Guard",
  description: "Enforces branch naming",
  category: "git",
  event: "PreToolUse",
  canBlock: false,
  params: [],
  template: "",
  tags: [],
};

// ─── getActiveBlocks ──────────────────────────────────────────────────────────

describe("getActiveBlocks", () => {
  it("hookEntries에서 builtinBlocks 매칭 확인", () => {
    const hookEntries: HookEntry[] = [
      { block: "command-guard", params: { blockedCommands: ["rm -rf"] } },
    ];
    const result = getActiveBlocks(hookEntries, [mockBlock, mockBlock2]);
    expect(result).toHaveLength(1);
    expect(result[0].block.id).toBe("command-guard");
    expect(result[0].params).toEqual({ blockedCommands: ["rm -rf"] });
  });

  it("알 수 없는 블록 id는 스킵", () => {
    const hookEntries: HookEntry[] = [
      { block: "nonexistent-block", params: {} },
      { block: "branch-guard", params: {} },
    ];
    const result = getActiveBlocks(hookEntries, [mockBlock, mockBlock2]);
    expect(result).toHaveLength(1);
    expect(result[0].block.id).toBe("branch-guard");
  });
});

// ─── getDormantBlocks ─────────────────────────────────────────────────────────

describe("getDormantBlocks", () => {
  it("이벤트 없는 블록 = dormant", () => {
    const activeBlocks = [
      { block: mockBlock, params: {} },
      { block: mockBlock2, params: {} },
    ];
    const dormant = getDormantBlocks(activeBlocks, []);
    expect(dormant).toContain("command-guard");
    expect(dormant).toContain("branch-guard");
  });

  it("이벤트 있는 블록은 dormant 아님", () => {
    const activeBlocks = [
      { block: mockBlock, params: {} },
      { block: mockBlock2, params: {} },
    ];
    const events: HookEvent[] = [
      makeEvent({ ts: "2024-01-01T10:00:00.000Z", hook: "catalog-command-guard.sh", decision: "block" }),
    ];
    const dormant = getDormantBlocks(activeBlocks, events);
    expect(dormant).not.toContain("command-guard");
    expect(dormant).toContain("branch-guard");
  });
});

// ─── getHourlyDistribution ────────────────────────────────────────────────────

describe("getHourlyDistribution", () => {
  it("이벤트를 시간대별로 정확히 분류", () => {
    // Use local time to avoid timezone issues with getHours()
    const makeLocalTs = (hour: number): string => {
      const d = new Date(2024, 0, 1, hour, 0, 0, 0);
      return d.toISOString();
    };
    const events: HookEvent[] = [
      makeEvent({ ts: makeLocalTs(10), hook: "guard", decision: "block" }),
      makeEvent({ ts: makeLocalTs(10), hook: "guard", decision: "allow" }),
      makeEvent({ ts: makeLocalTs(14), hook: "guard", decision: "block" }),
    ];
    const buckets = getHourlyDistribution(events);
    expect(buckets).toHaveLength(24);

    const hour10 = buckets.find(b => b.hour === 10)!;
    expect(hour10.total).toBe(2);
    expect(hour10.blockCount).toBe(1);
    expect(hour10.allowCount).toBe(1);

    const hour14 = buckets.find(b => b.hour === 14)!;
    expect(hour14.total).toBe(1);
    expect(hour14.blockCount).toBe(1);
    expect(hour14.allowCount).toBe(0);
  });

  it("빈 이벤트 → 24개 빈 버킷", () => {
    const buckets = getHourlyDistribution([]);
    expect(buckets).toHaveLength(24);
    expect(buckets.every(b => b.total === 0 && b.blockCount === 0 && b.allowCount === 0)).toBe(true);
  });
});

// ─── getDateFilteredEvents ────────────────────────────────────────────────────

describe("getDateFilteredEvents", () => {
  const now = new Date();
  const todayStr = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const yesterdayStr = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString();
  const tenDaysAgoStr = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 10).toISOString();

  const events: HookEvent[] = [
    makeEvent({ ts: todayStr, hook: "guard", decision: "allow" }),
    makeEvent({ ts: yesterdayStr, hook: "guard", decision: "block" }),
    makeEvent({ ts: tenDaysAgoStr, hook: "guard", decision: "allow" }),
  ];

  it('"today" 필터 — 오늘 이벤트만', () => {
    const filtered = getDateFilteredEvents(events, "today");
    expect(filtered).toHaveLength(1);
    expect(new Date(filtered[0].ts) >= new Date(now.getFullYear(), now.getMonth(), now.getDate())).toBe(true);
  });

  it('"week" 필터 — 7일 이내', () => {
    const filtered = getDateFilteredEvents(events, "week");
    // today and yesterday are within 7 days; 10 days ago is not
    expect(filtered.every(e => new Date(e.ts) >= new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7))).toBe(true);
    expect(filtered.some(e => e.ts === tenDaysAgoStr)).toBe(false);
  });

  it('"all" 필터 — 전체', () => {
    const filtered = getDateFilteredEvents(events, "all");
    expect(filtered).toHaveLength(3);
  });
});

// ─── getBlockDetail ───────────────────────────────────────────────────────────

describe("getBlockDetail", () => {
  const events: HookEvent[] = [
    makeEvent({ ts: "2024-01-01T10:00:00.000Z", hook: "catalog-command-guard.sh", decision: "allow" }),
    makeEvent({ ts: "2024-01-01T11:00:00.000Z", hook: "catalog-command-guard.sh", decision: "block", reason: "rm -rf blocked" }),
    makeEvent({ ts: "2024-01-01T12:00:00.000Z", hook: "catalog-command-guard.sh", decision: "allow" }),
  ];

  it("히트 수, blockCount, allowCount 정확성", () => {
    const detail = getBlockDetail("command-guard", events, [mockBlock, mockBlock2]);
    expect(detail.hits).toBe(3);
    expect(detail.blockCount).toBe(1);
    expect(detail.allowCount).toBe(2);
    expect(detail.id).toBe("command-guard");
    expect(detail.name).toBe("Command Guard");
    expect(detail.configured).toBe(true);
  });

  it("lastBlockReason 추출", () => {
    const detail = getBlockDetail("command-guard", events, [mockBlock, mockBlock2]);
    expect(detail.lastBlockReason).toBe("rm -rf blocked");
  });

  it("이벤트 0개 → hits=0, lastHit undefined", () => {
    const detail = getBlockDetail("command-guard", [], [mockBlock]);
    expect(detail.hits).toBe(0);
    expect(detail.lastHit).toBeUndefined();
    expect(detail.blockCount).toBe(0);
    expect(detail.allowCount).toBe(0);
  });
});

// ─── loadStatsData ────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stats-data-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("loadStatsData", () => {
  it("events.jsonl + harness.yaml 통합 로드", async () => {
    // Write events.jsonl
    const stateDir = path.join(tmpDir, ".claude/hooks/.state");
    await fs.mkdir(stateDir, { recursive: true });
    const events: HookEvent[] = [
      { ts: "2024-01-01T10:00:00.000Z", event: "PreToolUse", hook: "catalog-command-guard.sh", decision: "block", reason: "blocked" },
      { ts: "2024-01-01T11:00:00.000Z", event: "PreToolUse", hook: "catalog-command-guard.sh", decision: "allow" },
    ];
    await fs.writeFile(
      path.join(stateDir, "events.jsonl"),
      events.map(e => JSON.stringify(e)).join("\n") + "\n",
      "utf-8",
    );

    // Write harness.yaml
    const harnessYaml = `
version: "1.0"
project:
  name: test
  stacks: []
rules: []
hooks:
  - block: command-guard
    params:
      blockedCommands:
        - "rm -rf"
`;
    await fs.writeFile(path.join(tmpDir, "harness.yaml"), harnessYaml, "utf-8");

    const data = await loadStatsData(tmpDir, "all");

    expect(data.totalEvents).toBe(2);
    expect(data.blockCount).toBe(1);
    expect(data.allowCount).toBe(1);
    expect(data.blockRate).toBe(50);
    expect(data.blocks).toHaveLength(1);
    expect(data.blocks[0].id).toBe("command-guard");
    expect(data.dateRange).toBe("all");
  });

  it("파일 없을 때 graceful 빈 결과", async () => {
    const data = await loadStatsData(tmpDir, "all");

    expect(data.totalEvents).toBe(0);
    expect(data.blockCount).toBe(0);
    expect(data.allowCount).toBe(0);
    expect(data.blockRate).toBe(0);
    expect(data.blocks).toHaveLength(0);
    expect(data.hourlyDistribution).toHaveLength(24);
  });
});
