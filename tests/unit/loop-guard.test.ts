import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { loopGuard } from "../../src/catalog/blocks/loop-guard.js";
import { renderTemplate, applyDefaults } from "../../src/catalog/template-engine.js";
import { HarnessConfigSchema } from "../../src/core/harness-schema.js";
import { harnessToMergedConfigV2 } from "../../src/core/harness-converter-v2.js";

// Render the block and run it as a real hook: stdin carries the tool input,
// stubbed _emit_decision/_log_event record what the guard decided.
async function runGuard(opts: {
  filePath: string;
  env?: Record<string, string>;
  params?: Record<string, unknown>;
}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-guard-"));
  const params = applyDefaults(loopGuard, opts.params ?? {});
  const body = renderTemplate(loopGuard.template, params).replace(
    "INPUT=$(cat)",
    'INPUT=$(cat)\n_log_event() { :; }\n_emit_decision() { echo "DECISION:$1:$2"; }',
  );
  const script = path.join(dir, "guard.sh");
  await fs.writeFile(script, body, "utf-8");
  return execFileSync("bash", [script], {
    input: JSON.stringify({ tool_input: { file_path: opts.filePath } }),
    env: { ...process.env, ...opts.env },
    encoding: "utf-8",
  });
}

describe("loop-guard block", () => {
  it("has PreToolUse Edit|Write metadata and can block", () => {
    expect(loopGuard.event).toBe("PreToolUse");
    expect(loopGuard.matcher).toBe("Edit|Write");
    expect(loopGuard.canBlock).toBe(true);
  });

  it("stays silent for the architect (no OMH_LOOP marker)", async () => {
    const out = await runGuard({ filePath: "docs/work-orders/T-1.md" });
    expect(out).not.toContain("DECISION:block");
  });

  it("blocks the loop from writing its own work orders", async () => {
    const out = await runGuard({
      filePath: "docs/work-orders/T-1.md",
      env: { OMH_LOOP: "1" },
    });
    expect(out).toContain("DECISION:block");
  });

  it("blocks the loop from touching architect-only paths", async () => {
    const out = await runGuard({
      filePath: "ios/Runner.xcodeproj/project.pbxproj",
      env: { OMH_LOOP: "1" },
      params: { architectOnly: ["ios/Runner.xcodeproj"] },
    });
    expect(out).toContain("DECISION:block");
  });

  it("lets the loop edit ordinary source files", async () => {
    const out = await runGuard({ filePath: "src/app.ts", env: { OMH_LOOP: "1" } });
    expect(out).not.toContain("DECISION:block");
  });
});

describe("loop-guard wiring", () => {
  it("is added automatically when the loop engine is on", async () => {
    const harness = HarnessConfigSchema.parse({ version: "1.0" });
    const merged = await harnessToMergedConfigV2(harness);
    expect(merged.hooks.preToolUse.some((h) => h.id === "catalog-loop-guard")).toBe(true);
  });

  it("is absent when the loop engine is off", async () => {
    const harness = HarnessConfigSchema.parse({ version: "1.0", loop: { enabled: false } });
    const merged = await harnessToMergedConfigV2(harness);
    expect(merged.hooks.preToolUse.some((h) => h.id === "catalog-loop-guard")).toBe(false);
  });
});

describe("runner exports the loop marker", () => {
  it("sets OMH_LOOP=1 so the guard fires only inside loop sessions", async () => {
    const { computeLoopAssets } = await import("../../src/generators/loop-assets.js");
    const harness = HarnessConfigSchema.parse({ version: "1.0" });
    const merged = await harnessToMergedConfigV2(harness);
    const files = await computeLoopAssets({ projectDir: "/tmp/x", config: merged });
    const runner = files.find((f) => f.path.endsWith("run.sh"))?.content ?? "";
    expect(runner).toContain("export OMH_LOOP=1");
  });
});
