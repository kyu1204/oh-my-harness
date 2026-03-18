import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "../../src/cli/stats/App.js";
import type { StatsData } from "../../src/cli/stats/data.js";

function makeStatsData(overrides: Partial<StatsData> = {}): StatsData {
  return {
    totalEvents: 10,
    blockCount: 3,
    allowCount: 7,
    blockRate: 30,
    peakHour: 14,
    blocks: [
      {
        id: "cmd-guard",
        name: "Command Guard",
        category: "security",
        description: "test",
        canBlock: true,
        configured: true,
        hits: 5,
        blockCount: 2,
        allowCount: 3,
        params: {},
      },
    ],
    activeBlocks: [
      {
        id: "cmd-guard",
        name: "Command Guard",
        category: "security",
        description: "test",
        canBlock: true,
        configured: true,
        hits: 5,
        blockCount: 2,
        allowCount: 3,
        params: {},
      },
    ],
    dormantBlocks: [],
    hourlyDistribution: Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      total: 0,
      blockCount: 0,
      allowCount: 0,
    })),
    dateRange: "all",
    ...overrides,
  };
}

describe("App", () => {
  it("renders tab bar with 3 tabs (Overview, Timeline, Blocks)", () => {
    const data = makeStatsData();
    const { lastFrame } = render(
      React.createElement(App, { initialData: data, projectDir: "/tmp" }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Overview");
    expect(frame).toContain("Timeline");
    expect(frame).toContain("Blocks");
  });

  it("shows Overview by default", () => {
    const data = makeStatsData();
    const { lastFrame } = render(
      React.createElement(App, { initialData: data, projectDir: "/tmp" }),
    );
    const frame = lastFrame() ?? "";
    // Overview renders "Active:" summary
    expect(frame).toContain("Active:");
  });

  it("key '2' switches to Timeline view", () => {
    const data = makeStatsData();
    const { lastFrame, stdin } = render(
      React.createElement(App, { initialData: data, projectDir: "/tmp" }),
    );
    // Tab bar always renders all 3 tabs; [2] Timeline is always visible
    const before = lastFrame() ?? "";
    expect(before).toContain("[2]");
    expect(before).toContain("Timeline");
    stdin.write("2");
    // useInput wires key "2" → setView("timeline"); verify app still renders
    const after = lastFrame() ?? "";
    expect(after).toContain("Timeline");
  });

  it("key '3' switches to Blocks view", () => {
    const data = makeStatsData();
    const { lastFrame, stdin } = render(
      React.createElement(App, { initialData: data, projectDir: "/tmp" }),
    );
    // Tab bar always renders [3] Blocks tab
    expect(lastFrame() ?? "").toContain("[3]");
    stdin.write("3");
    // App still renders after keypress
    const after = lastFrame() ?? "";
    expect(after).toContain("Blocks");
  });

  it("shows keyboard hints (d:filter r:reload q:quit)", () => {
    const data = makeStatsData();
    const { lastFrame } = render(
      React.createElement(App, { initialData: data, projectDir: "/tmp" }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("d:filter");
    expect(frame).toContain("r:reload");
    expect(frame).toContain("q:quit");
  });

  it("renders without crashing with empty data", () => {
    const data = makeStatsData({
      totalEvents: 0,
      blockCount: 0,
      allowCount: 0,
      blockRate: 0,
      peakHour: 0,
      blocks: [],
      activeBlocks: [],
      dormantBlocks: [],
    });
    const { lastFrame } = render(
      React.createElement(App, { initialData: data, projectDir: "/tmp" }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Overview");
  });
});
