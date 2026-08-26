import { describe, it, expect } from "vitest";
import { HarnessConfigSchema } from "../../src/core/harness-schema.js";
import { harnessToMergedConfigV2 } from "../../src/core/harness-converter-v2.js";

describe("loop engine config", () => {
  it("is on by default, so a harness.yaml that never mentions it still gets a loop", () => {
    const parsed = HarnessConfigSchema.parse({ version: "1.0" });
    expect(parsed.loop.enabled).toBe(true);
    expect(parsed.loop.ledger).toBe("WORKPLAN.md");
    expect(parsed.loop.model).toBe("sonnet");
    expect(parsed.loop.runtime).toBe("claude");
  });

  it("accepts per-field overrides without losing the other defaults", () => {
    const parsed = HarnessConfigSchema.parse({ version: "1.0", loop: { model: "haiku" } });
    expect(parsed.loop.model).toBe("haiku");
    expect(parsed.loop.sentinel).toBe("OMH_GOAL_COMPLETE");
  });

  it("can be turned off explicitly", () => {
    const parsed = HarnessConfigSchema.parse({ version: "1.0", loop: { enabled: false } });
    expect(parsed.loop.enabled).toBe(false);
  });

  it("reaches MergedConfig so the generator emits loop assets", async () => {
    const harness = HarnessConfigSchema.parse({ version: "1.0" });
    const merged = await harnessToMergedConfigV2(harness);
    expect(merged.loop?.ledger).toBe("WORKPLAN.md");
  });

  it("leaves MergedConfig.loop unset when disabled", async () => {
    const harness = HarnessConfigSchema.parse({ version: "1.0", loop: { enabled: false } });
    const merged = await harnessToMergedConfigV2(harness);
    expect(merged.loop).toBeUndefined();
  });

  it("still reaches MergedConfig when catalog hooks are present (the other return path)", async () => {
    const harness = HarnessConfigSchema.parse({
      version: "1.0",
      hooks: [{ block: "branch-guard", params: {} }],
    });
    const merged = await harnessToMergedConfigV2(harness);
    expect(merged.loop?.ledger).toBe("WORKPLAN.md");
  });
});

describe("loop schema hardening (GPT G4)", () => {
  it("rejects an empty sentinel — an empty line must never complete the goal", () => {
    const result = HarnessConfigSchema.safeParse({ version: "1.0", loop: { sentinel: "" } });
    expect(result.success).toBe(false);
  });
});

describe("loop numeric constraints (round 4 N2)", () => {
  it("rejects zero and negative interval/blockedBackoff", () => {
    for (const loop of [{ interval: 0 }, { interval: -5 }, { blockedBackoff: 0 }, { blockedBackoff: -1 }]) {
      expect(HarnessConfigSchema.safeParse({ version: "1.0", loop }).success).toBe(false);
    }
  });
});

describe("loop path values accept shell metacharacters (argv spawn, no shell)", () => {
  it("accepts quotes, $ and backticks now that nothing is interpolated into shell", () => {
    for (const loop of [{ workOrders: "docs/it's" }, { ledger: "plan $(x).md" }, { architectOnly: ["ios/`x`"] }]) {
      expect(HarnessConfigSchema.safeParse({ version: "1.0", loop }).success).toBe(true);
    }
  });
  it("still rejects a newline inside a path", () => {
    expect(HarnessConfigSchema.safeParse({ version: "1.0", loop: { ledger: "a\nb.md" } }).success).toBe(false);
  });
});

describe("loop paths must be canonical project-relative (round 6)", () => {
  it("rejects ./, ../, absolute and trailing-slash forms the guard cannot compare", () => {
    for (const loop of [
      { workOrders: "./docs/work-orders" },
      { workOrders: "../docs/work-orders" },
      { workOrders: "/abs/docs/work-orders" },
      { workOrders: "docs/./work-orders" },
      { ledger: "docs/work-orders/" },
      { architectOnly: ["./ios"] },
    ]) {
      expect(HarnessConfigSchema.safeParse({ version: "1.0", loop }).success).toBe(false);
    }
  });
});

describe("supervisor knobs (L-07)", () => {
  it("defaults limitBackoff/emptyBackoff/stallStreak/turnTimeout and reaches MergedConfig", async () => {
    const parsed = HarnessConfigSchema.parse({ version: "1.0" });
    expect(parsed.loop).toMatchObject({ limitBackoff: 1800, emptyBackoff: 300, stallStreak: 3, turnTimeout: 7200 });
    const merged = await harnessToMergedConfigV2(parsed);
    expect(merged.loop).toMatchObject({ limitBackoff: 1800, emptyBackoff: 300, stallStreak: 3, turnTimeout: 7200 });
  });
  it("rejects zero, negative and (for stallStreak) fractional values", () => {
    for (const loop of [{ limitBackoff: 0 }, { emptyBackoff: -1 }, { stallStreak: 0 }, { stallStreak: 1.5 }, { turnTimeout: 0 }]) {
      expect(HarnessConfigSchema.safeParse({ version: "1.0", loop }).success).toBe(false);
    }
  });
});

describe("ledger must not live inside workOrders (round 9)", () => {
  it("rejects a ledger path under the work-orders directory — the sync would roll its progress back", () => {
    expect(HarnessConfigSchema.safeParse({ version: "1.0", loop: { workOrders: "docs/plan", ledger: "docs/plan/WORKPLAN.md" } }).success).toBe(false);
    expect(HarnessConfigSchema.safeParse({ version: "1.0", loop: { workOrders: "docs/plan", ledger: "docs/planning.md" } }).success).toBe(true);
  });
});

describe("loop protocol section", () => {
  it("adds a protocol section so CLAUDE.md and AGENTS.md both carry the rules", async () => {
    const harness = HarnessConfigSchema.parse({ version: "1.0" });
    const merged = await harnessToMergedConfigV2(harness);
    const section = merged.claudeMdSections.find((s) => s.id === "omh-loop-protocol");
    expect(section).toBeDefined();
    const body = section?.content ?? "";
    expect(body.startsWith("## ")).toBe(true);
    expect(body).toContain("WORKPLAN.md");
    expect(body).toContain("BLOCKED");
    expect(body).toContain("omh loop start");
  });

  it("names the architect-only paths verbatim, since an abstract ban is not obeyed", async () => {
    const harness = HarnessConfigSchema.parse({
      version: "1.0",
      loop: { architectOnly: ["ios/Runner.xcodeproj"] },
    });
    const merged = await harnessToMergedConfigV2(harness);
    const body = merged.claudeMdSections.find((s) => s.id === "omh-loop-protocol")?.content ?? "";
    expect(body).toContain("ios/Runner.xcodeproj");
  });

  it("adds no section when the loop engine is off", async () => {
    const harness = HarnessConfigSchema.parse({ version: "1.0", loop: { enabled: false } });
    const merged = await harnessToMergedConfigV2(harness);
    expect(merged.claudeMdSections.some((s) => s.id === "omh-loop-protocol")).toBe(false);
  });
});
