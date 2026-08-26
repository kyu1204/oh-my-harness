import { describe, it, expect } from "vitest";
import { loopRules, renderPrompt, renderProtocolSection, renderSkill } from "../../src/loop/protocol.js";
import type { LoopConfig } from "../../src/core/merged-config.js";

const cfg: LoopConfig = {
  ledger: "WORKPLAN.md",
  workOrders: "docs/work-orders",
  model: "sonnet",
  sentinel: "OMH_GOAL_COMPLETE",
  interval: 120,
  blockedBackoff: 1800,
  architectOnly: ["ios/Runner.xcodeproj"],
  isolate: true,
  runtime: "claude",
} as LoopConfig;

describe("loopRules — single source", () => {
  it("names the ledger, work orders, architect-only paths and sentinel", () => {
    const rules = loopRules(cfg).join("\n");
    expect(rules).toContain("WORKPLAN.md");
    expect(rules).toContain("docs/work-orders/<ID>.md");
    expect(rules).toContain("`ios/Runner.xcodeproj`");
    expect(rules).toContain("OMH_GOAL_COMPLETE");
  });

  it("says 'none declared' when no architect-only paths are configured", () => {
    expect(loopRules({ ...cfg, architectOnly: [] }).join("\n")).toContain("none declared");
  });
});

describe("the three renderers all carry every rule", () => {
  const rules = loopRules(cfg);
  for (const [name, render] of [
    ["prompt", renderPrompt],
    ["section", renderProtocolSection],
    ["skill", renderSkill],
  ] as const) {
    it(`${name} contains all ${rules.length} rules verbatim`, () => {
      const out = render(cfg);
      for (const rule of rules) expect(out).toContain(rule);
    });
  }
});

describe("renderProtocolSection", () => {
  it("starts with the managed-section heading and lists the omh loop commands", () => {
    const out = renderProtocolSection(cfg);
    expect(out.startsWith("## Autonomous Loop Protocol")).toBe(true);
    expect(out).toContain("omh loop start");
    expect(out).toContain("omh loop stop");
    expect(out).toContain("tail -f .omh/state/loop/runs/");
  });
});

describe("renderSkill", () => {
  it("has the skill frontmatter and routes to omh loop, never to a shell runner", () => {
    const out = renderSkill(cfg);
    expect(out.startsWith("---\nname: omh-loop\n")).toBe(true);
    expect(out).toContain("description:");
    expect(out).toContain("omh loop start");
    expect(out).toContain("omh loop status");
    expect(out).toContain("tail -f .omh/state/loop/runs/");
    expect(out).not.toContain("nohup");
    expect(out).not.toContain("run.sh");
  });
});

describe("renderPrompt", () => {
  it("opens as a loop iteration and ends with the sentinel rule", () => {
    const out = renderPrompt(cfg);
    expect(out.startsWith("Autonomous loop iteration.")).toBe(true);
    expect(out.trim().split("\n").at(-1)).toContain("OMH_GOAL_COMPLETE");
  });
});
