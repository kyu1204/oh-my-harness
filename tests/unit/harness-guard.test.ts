import { describe, it, expect } from "vitest";
import { harnessGuard } from "../../src/catalog/blocks/harness-guard.js";
import { builtinBlocks } from "../../src/catalog/blocks/index.js";

describe("harnessGuard block", () => {
  it("has correct metadata", () => {
    expect(harnessGuard.id).toBe("harness-guard");
    expect(harnessGuard.event).toBe("PreToolUse");
    expect(harnessGuard.matcher).toBe("Bash");
    expect(harnessGuard.canBlock).toBe(true);
  });

  it("is registered in the builtin catalog", () => {
    expect(builtinBlocks.map((b) => b.id)).toContain("harness-guard");
  });

  it("matches through the shared shell-token helper and protects the generated files", () => {
    expect(harnessGuard.template).toContain("_omh_simple_commands");
    for (const p of [".omh", ".claude/settings.json", ".codex/hooks.json", ".codex/config.toml", ".pi/extensions/omh-harness.ts"]) {
      expect(harnessGuard.template).toContain(`"${p}"`);
    }
  });

  it("only has an optional extraPaths param", () => {
    expect(harnessGuard.params.map((p) => p.name)).toEqual(["extraPaths"]);
    expect(harnessGuard.params[0].required).toBe(false);
  });
});

describe("harness-guard wiring", () => {
  it("is added automatically whenever the harness has any other hook (#113)", async () => {
    const { HarnessConfigSchema } = await import("../../src/core/harness-schema.js");
    const { harnessToMergedConfigV2 } = await import("../../src/core/harness-converter-v2.js");
    const harness = HarnessConfigSchema.parse({ version: "1.0" });
    const merged = await harnessToMergedConfigV2(harness);
    expect(merged.hooks.preToolUse.some((h) => h.id === "catalog-harness-guard")).toBe(true);
  });

  it("respects an explicit entry (mode and extraPaths) instead of adding a second one", async () => {
    const { HarnessConfigSchema } = await import("../../src/core/harness-schema.js");
    const { harnessToMergedConfigV2 } = await import("../../src/core/harness-converter-v2.js");
    const harness = HarnessConfigSchema.parse({
      version: "1.0",
      hooks: [{ block: "harness-guard", params: { extraPaths: ["ops/protected.yml"] }, mode: "ask" }],
    });
    const merged = await harnessToMergedConfigV2(harness);
    const guards = merged.hooks.preToolUse.filter((h) => h.id.startsWith("catalog-harness-guard"));
    expect(guards).toHaveLength(1);
    expect(guards[0].mode).toBe("ask");
    expect(guards[0].inline).toContain('"ops/protected.yml"');
  });

  it("is absent when the harness has no hooks at all", async () => {
    const { HarnessConfigSchema } = await import("../../src/core/harness-schema.js");
    const { harnessToMergedConfigV2 } = await import("../../src/core/harness-converter-v2.js");
    const harness = HarnessConfigSchema.parse({ version: "1.0", loop: { enabled: false } });
    const merged = await harnessToMergedConfigV2(harness);
    expect((merged.hooks?.preToolUse ?? []).some((h) => h.id === "catalog-harness-guard")).toBe(false);
  });
});
