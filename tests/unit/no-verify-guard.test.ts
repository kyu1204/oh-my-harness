import { describe, it, expect } from "vitest";
import { noVerifyGuard } from "../../src/catalog/blocks/no-verify-guard.js";
import { builtinBlocks } from "../../src/catalog/blocks/index.js";

describe("noVerifyGuard block", () => {
  it("has correct metadata", () => {
    expect(noVerifyGuard.id).toBe("no-verify-guard");
    expect(noVerifyGuard.event).toBe("PreToolUse");
    expect(noVerifyGuard.matcher).toBe("Bash");
    expect(noVerifyGuard.canBlock).toBe(true);
    expect(noVerifyGuard.params).toEqual([]);
  });

  it("is registered in the builtin catalog", () => {
    expect(builtinBlocks.map((b) => b.id)).toContain("no-verify-guard");
  });

  it("inspects tokens through the shared shell-token helper, not raw grep", () => {
    expect(noVerifyGuard.template).toContain("_omh_simple_commands");
    expect(noVerifyGuard.template).not.toContain("grep");
  });
});

describe("no-verify-guard wiring (#114)", () => {
  it("is in the default hook set whenever the harness has any other hook", async () => {
    const { HarnessConfigSchema } = await import("../../src/core/harness-schema.js");
    const { harnessToMergedConfigV2 } = await import("../../src/core/harness-converter-v2.js");
    const merged = await harnessToMergedConfigV2(HarnessConfigSchema.parse({ version: "1.0" }));
    expect(merged.hooks.preToolUse.some((h) => h.id === "catalog-no-verify-guard")).toBe(true);
  });

  it("an explicit entry keeps its mode instead of being duplicated", async () => {
    const { HarnessConfigSchema } = await import("../../src/core/harness-schema.js");
    const { harnessToMergedConfigV2 } = await import("../../src/core/harness-converter-v2.js");
    const merged = await harnessToMergedConfigV2(
      HarnessConfigSchema.parse({ version: "1.0", hooks: [{ block: "no-verify-guard", params: {}, mode: "ask" }] }),
    );
    const guards = merged.hooks.preToolUse.filter((h) => h.id.startsWith("catalog-no-verify-guard"));
    expect(guards).toHaveLength(1);
    expect(guards[0].mode).toBe("ask");
  });
});
