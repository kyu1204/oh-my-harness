import { describe, it, expect } from "vitest";
import { forcePushGuard } from "../../src/catalog/blocks/force-push-guard.js";
import { builtinBlocks } from "../../src/catalog/blocks/index.js";

describe("forcePushGuard block", () => {
  it("has correct metadata", () => {
    expect(forcePushGuard.id).toBe("force-push-guard");
    expect(forcePushGuard.event).toBe("PreToolUse");
    expect(forcePushGuard.matcher).toBe("Bash");
    expect(forcePushGuard.canBlock).toBe(true);
  });

  it("is registered in the builtin catalog", () => {
    expect(builtinBlocks.map((b) => b.id)).toContain("force-push-guard");
  });

  it("protects main and master by default and allows --force-with-lease by default", () => {
    const byName = Object.fromEntries(forcePushGuard.params.map((p) => [p.name, p]));
    expect(byName.protected.default).toEqual(["main", "master"]);
    expect(byName.protected.required).toBe(false);
    expect(byName.allowLease.default).toBe(true);
  });

  it("inspects tokens through the shared shell-token helper, not raw grep", () => {
    expect(forcePushGuard.template).toContain("_omh_simple_commands");
    expect(forcePushGuard.template).not.toContain("grep");
  });
});

describe("force-push-guard wiring (#114)", () => {
  it("is in the default hook set whenever the harness has any other hook", async () => {
    const { HarnessConfigSchema } = await import("../../src/core/harness-schema.js");
    const { harnessToMergedConfigV2 } = await import("../../src/core/harness-converter-v2.js");
    const merged = await harnessToMergedConfigV2(HarnessConfigSchema.parse({ version: "1.0" }));
    expect(merged.hooks.preToolUse.some((h) => h.id === "catalog-force-push-guard")).toBe(true);
  });

  it("an explicit entry keeps its mode instead of being duplicated", async () => {
    const { HarnessConfigSchema } = await import("../../src/core/harness-schema.js");
    const { harnessToMergedConfigV2 } = await import("../../src/core/harness-converter-v2.js");
    const merged = await harnessToMergedConfigV2(
      HarnessConfigSchema.parse({ version: "1.0", hooks: [{ block: "force-push-guard", params: {}, mode: "ask" }] }),
    );
    const guards = merged.hooks.preToolUse.filter((h) => h.id.startsWith("catalog-force-push-guard"));
    expect(guards).toHaveLength(1);
    expect(guards[0].mode).toBe("ask");
  });
});
