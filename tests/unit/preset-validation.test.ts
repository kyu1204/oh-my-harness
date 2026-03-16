import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadPreset } from "../../src/core/preset-loader.js";

const PRESETS_DIR = path.resolve(import.meta.dirname, "../../presets");

const BUILTIN_PRESETS = ["_base", "nextjs", "fastapi", "nextjs-fastapi"];

describe("built-in preset validation", () => {
  it.each(BUILTIN_PRESETS)("parses %s preset without errors", async (name) => {
    const preset = await loadPreset(path.join(PRESETS_DIR, name));
    expect(preset).toBeDefined();
  });

  it.each(BUILTIN_PRESETS)("%s has required fields", async (name) => {
    const preset = await loadPreset(path.join(PRESETS_DIR, name));
    expect(preset.name).toBe(name);
    expect(preset.displayName).toBeTruthy();
    expect(preset.description).toBeTruthy();
    expect(preset.version).toBeTruthy();
  });

  it("_base has no extends", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "_base"));
    expect(preset.extends).toBeUndefined();
  });

  it("nextjs extends _base", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs"));
    expect(preset.extends).toContain("_base");
  });

  it("fastapi extends _base", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "fastapi"));
    expect(preset.extends).toContain("_base");
  });

  it("nextjs-fastapi extends _base, nextjs, and fastapi", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs-fastapi"));
    expect(preset.extends).toContain("_base");
    expect(preset.extends).toContain("nextjs");
    expect(preset.extends).toContain("fastapi");
  });

  it("extends chains reference existing presets", async () => {
    for (const name of BUILTIN_PRESETS) {
      const preset = await loadPreset(path.join(PRESETS_DIR, name));
      if (!preset.extends) continue;
      for (const ref of preset.extends) {
        expect(BUILTIN_PRESETS).toContain(ref);
      }
    }
  });

  it("_base has claudeMd sections", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "_base"));
    expect(preset.claudeMd?.sections.length).toBeGreaterThan(0);
  });

  it("nextjs has expected claudeMd section ids", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs"));
    const ids = preset.claudeMd?.sections.map((s) => s.id) ?? [];
    expect(ids).toContain("nextjs-rules");
    expect(ids).toContain("nextjs-testing");
    expect(ids).toContain("nextjs-structure");
  });

  it("fastapi has expected claudeMd section ids", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "fastapi"));
    const ids = preset.claudeMd?.sections.map((s) => s.id) ?? [];
    expect(ids).toContain("fastapi-rules");
    expect(ids).toContain("fastapi-testing");
    expect(ids).toContain("fastapi-structure");
  });

  it("nextjs-fastapi has fullstack-rules section", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs-fastapi"));
    const ids = preset.claudeMd?.sections.map((s) => s.id) ?? [];
    expect(ids).toContain("fullstack-rules");
  });

  it("nextjs has hooks", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs"));
    expect(preset.hooks?.preToolUse?.length).toBeGreaterThan(0);
    expect(preset.hooks?.postToolUse?.length).toBeGreaterThan(0);
  });

  it("fastapi has hooks", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "fastapi"));
    expect(preset.hooks?.preToolUse?.length).toBeGreaterThan(0);
    expect(preset.hooks?.postToolUse?.length).toBeGreaterThan(0);
  });

  it("nextjs-fastapi has preToolUse hooks", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs-fastapi"));
    expect(preset.hooks?.preToolUse?.length).toBeGreaterThan(0);
  });

  it("nextjs has settings permissions", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs"));
    expect(preset.settings?.permissions?.allow?.length).toBeGreaterThan(0);
    expect(preset.settings?.permissions?.deny?.length).toBeGreaterThan(0);
  });

  it("fastapi has settings permissions", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "fastapi"));
    expect(preset.settings?.permissions?.allow?.length).toBeGreaterThan(0);
    expect(preset.settings?.permissions?.deny?.length).toBeGreaterThan(0);
  });

  it("nextjs has expected variables", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs"));
    expect(preset.variables?.framework).toBe("nextjs");
    expect(preset.variables?.language).toBe("typescript");
  });

  it("fastapi has expected variables", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "fastapi"));
    expect(preset.variables?.framework).toBe("fastapi");
    expect(preset.variables?.language).toBe("python");
  });

  it("nextjs-fastapi has expected variables", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs-fastapi"));
    expect(preset.variables?.framework).toBe("nextjs-fastapi");
    expect(preset.variables?.type).toBe("fullstack");
  });
});
