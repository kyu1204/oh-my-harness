// stats-blocks component tests
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Blocks } from "../../src/cli/stats/components/Blocks.js";
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

function makeStatsData(blocks: BlockStats[]): StatsData {
  return {
    totalEvents: blocks.reduce((sum, b) => sum + b.hits, 0),
    blockCount: blocks.reduce((sum, b) => sum + b.blockCount, 0),
    allowCount: blocks.reduce((sum, b) => sum + b.allowCount, 0),
    blockRate: 0,
    peakHour: 0,
    blocks,
    activeBlocks: blocks.filter(b => b.hits > 0),
    dormantBlocks: blocks.filter(b => b.hits === 0),
    hourlyDistribution: Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0, blockCount: 0, allowCount: 0 })),
    dateRange: "all",
  };
}

describe("Blocks", () => {
  it("renders list of all configured blocks", () => {
    const blocks = [
      makeBlockStats({ id: "block-a", name: "Block A" }),
      makeBlockStats({ id: "block-b", name: "Block B" }),
    ];
    const data = makeStatsData(blocks);
    const { lastFrame } = render(React.createElement(Blocks, { data, selectedIndex: 0 }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("block-a");
    expect(frame).toContain("block-b");
  });

  it("shows 'No blocks configured' when blocks array is empty", () => {
    const data = makeStatsData([]);
    const { lastFrame } = render(React.createElement(Blocks, { data, selectedIndex: 0 }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No blocks configured");
  });

  it("shows detail panel with name, category, description for selected block", () => {
    const block = makeBlockStats({
      id: "command-guard",
      name: "Command Guard",
      category: "security",
      description: "Guards dangerous commands",
    });
    const data = makeStatsData([block]);
    const { lastFrame } = render(React.createElement(Blocks, { data, selectedIndex: 0 }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Command Guard");
    expect(frame).toContain("security");
    expect(frame).toContain("Guards dangerous commands");
  });

  it("shows hit counts (hits, block, allow) for selected block", () => {
    const block = makeBlockStats({ hits: 15, blockCount: 5, allowCount: 10 });
    const data = makeStatsData([block]);
    const { lastFrame } = render(React.createElement(Blocks, { data, selectedIndex: 0 }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("15");
    expect(frame).toContain("5");
    expect(frame).toContain("10");
  });

  it("shows params when block has params", () => {
    const block = makeBlockStats({ params: { maxLength: 100, strict: true } });
    const data = makeStatsData([block]);
    const { lastFrame } = render(React.createElement(Blocks, { data, selectedIndex: 0 }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Params");
    expect(frame).toContain("maxLength");
    expect(frame).toContain("100");
  });

  it("shows lastBlockReason when present", () => {
    const block = makeBlockStats({ lastBlockReason: "Matched forbidden pattern" });
    const data = makeStatsData([block]);
    const { lastFrame } = render(React.createElement(Blocks, { data, selectedIndex: 0 }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Matched forbidden pattern");
  });

  it("shows hit count in list for blocks with hits", () => {
    const block = makeBlockStats({ id: "active-block", hits: 7 });
    const data = makeStatsData([block]);
    const { lastFrame } = render(React.createElement(Blocks, { data, selectedIndex: 0 }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("active-block");
    expect(frame).toContain("(7)");
  });

  it("clamps selectedIndex to valid range (below 0)", () => {
    const blocks = [makeBlockStats({ id: "only-block" })];
    const data = makeStatsData(blocks);
    const { lastFrame } = render(React.createElement(Blocks, { data, selectedIndex: -5 }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("only-block");
    expect(frame).toContain("Test Block");
  });

  it("clamps selectedIndex to valid range (above max)", () => {
    const blocks = [
      makeBlockStats({ id: "block-first", name: "First Block" }),
      makeBlockStats({ id: "block-second", name: "Second Block" }),
    ];
    const data = makeStatsData(blocks);
    const { lastFrame } = render(React.createElement(Blocks, { data, selectedIndex: 99 }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Second Block");
  });
});
