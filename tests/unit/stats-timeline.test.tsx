// TDD: Timeline component tests
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Timeline } from "../../src/cli/stats/components/Timeline.js";
import type { StatsData, HourlyBucket } from "../../src/cli/stats/data.js";

function makeHourlyBuckets(overrides: Partial<Record<number, { total: number; blockCount: number; allowCount: number }>> = {}): HourlyBucket[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    total: 0,
    blockCount: 0,
    allowCount: 0,
    ...overrides[hour],
  }));
}

function makeStatsData(overrides: Partial<StatsData> = {}): StatsData {
  return {
    totalEvents: 0,
    blockCount: 0,
    allowCount: 0,
    blockRate: 0,
    peakHour: 0,
    blocks: [],
    activeBlocks: [],
    dormantBlocks: [],
    hourlyDistribution: makeHourlyBuckets(),
    dateRange: "all",
    ...overrides,
  };
}

describe("Timeline", () => {
  it("renders Events summary with total count", () => {
    const data = makeStatsData({ totalEvents: 42 });
    const { lastFrame } = render(React.createElement(Timeline, { data }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Events: 42");
  });

  it("renders block rate percentage", () => {
    const data = makeStatsData({ blockRate: 25 });
    const { lastFrame } = render(React.createElement(Timeline, { data }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Block rate: 25%");
  });

  it("renders peak hour in HH:00 format", () => {
    const data = makeStatsData({ peakHour: 9 });
    const { lastFrame } = render(React.createElement(Timeline, { data }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Peak: 09:00");
  });

  it("renders date range label", () => {
    const data = makeStatsData({ dateRange: "today" });
    const { lastFrame } = render(React.createElement(Timeline, { data }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Range: today");
  });

  it("shows No events recorded when all buckets are zero", () => {
    const data = makeStatsData({ totalEvents: 0 });
    const { lastFrame } = render(React.createElement(Timeline, { data }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No events recorded");
  });

  it("renders top hours with event counts when events exist", () => {
    const data = makeStatsData({
      totalEvents: 10,
      peakHour: 14,
      hourlyDistribution: makeHourlyBuckets({
        14: { total: 10, blockCount: 2, allowCount: 8 },
      }),
    });
    const { lastFrame } = render(React.createElement(Timeline, { data }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("14:00");
    expect(frame).toContain("10 events");
  });

  it("shows block count in top hours when blocks exist", () => {
    const data = makeStatsData({
      totalEvents: 5,
      peakHour: 10,
      hourlyDistribution: makeHourlyBuckets({
        10: { total: 5, blockCount: 3, allowCount: 2 },
      }),
    });
    const { lastFrame } = render(React.createElement(Timeline, { data }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("3 block");
  });

  it("renders a 24-character heatmap row", () => {
    const data = makeStatsData({
      totalEvents: 5,
      hourlyDistribution: makeHourlyBuckets({
        0: { total: 5, blockCount: 0, allowCount: 5 },
      }),
    });
    const { lastFrame } = render(React.createElement(Timeline, { data }));
    const frame = lastFrame() ?? "";
    // heatmap chars: ░ ▒ ▓ █
    const heatmapChars = (frame.match(/[░▒▓█]/g) ?? []);
    expect(heatmapChars.length).toBeGreaterThanOrEqual(24);
  });
});
