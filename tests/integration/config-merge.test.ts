import { describe, it, expect } from "vitest";
import { mergePresets } from "../../src/core/config-merger.js";
import type { PresetConfig } from "../../src/core/preset-types.js";

describe("mergePresets()", () => {
  it("accumulates hooks from two presets", () => {
    const presetA: PresetConfig = {
      name: "preset-a",
      displayName: "Preset A",
      description: "First preset",
      hooks: {
        preToolUse: [
          { id: "hook-a", matcher: "Bash", inline: "#!/bin/bash\nexit 0" },
        ],
      },
    };
    const presetB: PresetConfig = {
      name: "preset-b",
      displayName: "Preset B",
      description: "Second preset",
      hooks: {
        preToolUse: [
          { id: "hook-b", matcher: "Edit", inline: "#!/bin/bash\nexit 0" },
        ],
      },
    };

    const merged = mergePresets([presetA, presetB]);

    const ids = merged.hooks.preToolUse.map((h) => h.id);
    expect(ids).toContain("hook-a");
    expect(ids).toContain("hook-b");
    expect(merged.hooks.preToolUse).toHaveLength(2);
  });

  it("later preset wins when two presets share a hook id", () => {
    const presetA: PresetConfig = {
      name: "preset-a",
      displayName: "Preset A",
      description: "First",
      hooks: {
        preToolUse: [
          { id: "shared-hook", matcher: "Bash", inline: "#!/bin/bash\necho first\nexit 0" },
        ],
      },
    };
    const presetB: PresetConfig = {
      name: "preset-b",
      displayName: "Preset B",
      description: "Second",
      hooks: {
        preToolUse: [
          { id: "shared-hook", matcher: "Bash", inline: "#!/bin/bash\necho second\nexit 0" },
        ],
      },
    };

    const merged = mergePresets([presetA, presetB]);

    expect(merged.hooks.preToolUse).toHaveLength(1);
    expect(merged.hooks.preToolUse[0].inline).toContain("echo second");
  });

  it("merges settings permissions by accumulating allow and deny arrays", () => {
    const presetA: PresetConfig = {
      name: "preset-a",
      displayName: "Preset A",
      description: "First",
      settings: {
        permissions: {
          allow: ["Bash(npm test*)"],
          deny: ["Bash(rm -rf /)"],
        },
      },
    };
    const presetB: PresetConfig = {
      name: "preset-b",
      displayName: "Preset B",
      description: "Second",
      settings: {
        permissions: {
          allow: ["Bash(pnpm*)"],
          deny: ["Bash(curl*)"],
        },
      },
    };

    const merged = mergePresets([presetA, presetB]);

    expect(merged.settings.permissions.allow).toContain("Bash(npm test*)");
    expect(merged.settings.permissions.allow).toContain("Bash(pnpm*)");
    expect(merged.settings.permissions.deny).toContain("Bash(rm -rf /)");
    expect(merged.settings.permissions.deny).toContain("Bash(curl*)");
  });

  it("includes all claudeMdSections from both presets", () => {
    const presetA: PresetConfig = {
      name: "preset-a",
      displayName: "Preset A",
      description: "First",
      claudeMd: {
        sections: [
          { id: "section-a", title: "Section A", content: "Content A", priority: 10 },
        ],
      },
    };
    const presetB: PresetConfig = {
      name: "preset-b",
      displayName: "Preset B",
      description: "Second",
      claudeMd: {
        sections: [
          { id: "section-b", title: "Section B", content: "Content B", priority: 20 },
        ],
      },
    };

    const merged = mergePresets([presetA, presetB]);

    const ids = merged.claudeMdSections.map((s) => s.id);
    expect(ids).toContain("section-a");
    expect(ids).toContain("section-b");
    expect(merged.claudeMdSections).toHaveLength(2);
  });

  it("later preset wins when two presets share a section id", () => {
    const presetA: PresetConfig = {
      name: "preset-a",
      displayName: "Preset A",
      description: "First",
      claudeMd: {
        sections: [
          { id: "shared-section", title: "Shared", content: "From A", priority: 10 },
        ],
      },
    };
    const presetB: PresetConfig = {
      name: "preset-b",
      displayName: "Preset B",
      description: "Second",
      claudeMd: {
        sections: [
          { id: "shared-section", title: "Shared", content: "From B", priority: 10 },
        ],
      },
    };

    const merged = mergePresets([presetA, presetB]);

    expect(merged.claudeMdSections).toHaveLength(1);
    expect(merged.claudeMdSections[0].content).toBe("From B");
  });
});
