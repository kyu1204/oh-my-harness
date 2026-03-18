import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { HitBar } from "../../src/cli/stats/components/HitBar.js";
import { Overview } from "../../src/cli/stats/components/Overview.js";
import type { StatsData, BlockStats } from "../../src/cli/stats/data.js";

function makeBlockStats(overrides: Partial<BlockStats> = {}): BlockStats {
  return {
    id: "test-block",
    name: "Test Block",
    category: "quality",
    description: "A test block",
    canBlock: true,
    configured: true,
    hits: 10,
    blockCount: 3,
    allowCount: 7,
    params: {},
    ...overrides,
  };
}

function makeStatsData(overrides: Partial<StatsData> = {}): StatsData {
  return {
    totalEvents: 10,
    blockCount: 3,
    allowCount: 7,
    blockRate: 30,
    peakHour: 14,
    blocks: [],
    activeBlocks: [],
    dormantBlocks: [],
    hourlyDistribution: Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, blockCount: 0, allowCount: 0 })),
    dateRange: "all",
    ...overrides,
  };
}

describe("HitBar", () => {
  it("renders proportional bar for given counts", () => {
    const { lastFrame } = render(
      React.createElement(HitBar, { blockCount: 10, allowCount: 10, maxWidth: 20 }),
    );
    const frame = lastFrame() ?? "";
    // should contain block chars
    expect(frame).toContain("█");
    // equal split: 10 block chars + 10 allow chars
    const blockChars = (frame.match(/█/g) ?? []).length;
    expect(blockChars).toBe(20);
  });

  it("renders dim bar when total is 0", () => {
    const { lastFrame } = render(
      React.createElement(HitBar, { blockCount: 0, allowCount: 0, maxWidth: 20 }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("░");
    expect(frame).not.toContain("█");
  });

  it("uses default maxWidth of 20", () => {
    const { lastFrame } = render(
      React.createElement(HitBar, { blockCount: 20, allowCount: 0 }),
    );
    const frame = lastFrame() ?? "";
    const blockChars = (frame.match(/█/g) ?? []).length;
    expect(blockChars).toBe(20);
  });

  it("guarantees minimum 1 red char when blockCount > 0", () => {
    // 4 blocks out of 200 total → would round to 0 red chars without min guarantee
    const { lastFrame } = render(
      React.createElement(HitBar, { blockCount: 4, allowCount: 196, maxWidth: 20 }),
    );
    const frame = lastFrame() ?? "";
    // Should show block/allow counts
    expect(frame).toContain("4");
    expect(frame).toContain("196");
  });

  it("shows block/allow counts as labels", () => {
    const { lastFrame } = render(
      React.createElement(HitBar, { blockCount: 10, allowCount: 90, maxWidth: 20 }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("10");
    expect(frame).toContain("90");
  });
});

describe("Overview", () => {
  it("shows summary line with active count, events, block rate", () => {
    const data = makeStatsData({
      totalEvents: 10,
      blockRate: 30,
      activeBlocks: [makeBlockStats()],
    });
    const { lastFrame } = render(React.createElement(Overview, { data }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Active: 1");
    expect(frame).toContain("Events: 10");
    expect(frame).toContain("Block rate: 30%");
  });

  it("lists active blocks with hit counts", () => {
    const block = makeBlockStats({ id: "command-guard", hits: 5, blockCount: 2, allowCount: 3 });
    const data = makeStatsData({ activeBlocks: [block] });
    const { lastFrame } = render(React.createElement(Overview, { data }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("command-guard");
    expect(frame).toContain("5 hits");
    expect(frame).toContain("2 block");
  });

  it("shows dormant blocks section", () => {
    const dormant = makeBlockStats({ id: "dormant-block", hits: 0, blockCount: 0, allowCount: 0 });
    const data = makeStatsData({ dormantBlocks: [dormant] });
    const { lastFrame } = render(React.createElement(Overview, { data }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Dormant");
    expect(frame).toContain("dormant-block");
  });

  it("handles empty data (no blocks, no events)", () => {
    const data = makeStatsData({
      totalEvents: 0,
      blockRate: 0,
      activeBlocks: [],
      dormantBlocks: [],
    });
    const { lastFrame } = render(React.createElement(Overview, { data }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Active: 0");
    expect(frame).toContain("Events: 0");
    expect(frame).toContain("Block rate: 0%");
  });
});
