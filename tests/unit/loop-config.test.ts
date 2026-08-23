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
