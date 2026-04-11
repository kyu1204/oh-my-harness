import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { generateSettings } from "../../src/generators/settings.js";
import type { MergedConfig } from "../../src/core/preset-types.js";

interface HooksOutput {
  hooksConfig: Record<string, Array<{ matcher: string; hooks: string[] }>>;
  generatedFiles: string[];
}

const makeMergedConfig = (overrides: Partial<MergedConfig> = {}): MergedConfig => ({
  presets: ["_base", "nextjs"],
  variables: {},
  claudeMdSections: [],
  hooks: { preToolUse: [], postToolUse: [] },
  settings: {
    permissions: {
      allow: ["Bash(pnpm test*)"],
      deny: ["Bash(rm -rf /)"],
    },
  },
  ...overrides,
});

const makeHooksOutput = (overrides: Partial<HooksOutput> = {}): HooksOutput => ({
  hooksConfig: {
    PreToolUse: [{ matcher: "Bash", hooks: ["~/.claude/hooks/command-guard.sh"] }],
  },
  generatedFiles: [],
  ...overrides,
});

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-settings-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("generateSettings", () => {
  it("generates settings.json from scratch", async () => {
    const config = makeMergedConfig();
    const hooksOutput = makeHooksOutput();

    await generateSettings({ projectDir: tmpDir, config, hooksOutput });

    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    const raw = await fs.readFile(settingsPath, "utf-8");
    const settings = JSON.parse(raw);

    expect(settings).toBeDefined();
    expect(typeof settings).toBe("object");
  });

  it("includes permissions from config", async () => {
    const config = makeMergedConfig();
    const hooksOutput = makeHooksOutput();

    await generateSettings({ projectDir: tmpDir, config, hooksOutput });

    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));

    expect(settings.permissions.allow).toContain("Bash(pnpm test*)");
    expect(settings.permissions.deny).toContain("Bash(rm -rf /)");
  });

  it("includes hooks config in output", async () => {
    const config = makeMergedConfig();
    const hooksOutput = makeHooksOutput();

    await generateSettings({ projectDir: tmpDir, config, hooksOutput });

    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));

    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.PreToolUse).toBeDefined();
    expect(settings.hooks.PreToolUse[0].matcher).toBe("Bash");
  });

  it("adds _ohMyHarness metadata", async () => {
    const config = makeMergedConfig();
    const hooksOutput = makeHooksOutput();

    await generateSettings({ projectDir: tmpDir, config, hooksOutput });

    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));

    expect(settings._ohMyHarness).toBeDefined();
    expect(settings._ohMyHarness.presets).toEqual(["_base", "nextjs"]);
    expect(typeof settings._ohMyHarness.managedAt).toBe("string");
    // Should be a valid ISO timestamp
    expect(() => new Date(settings._ohMyHarness.managedAt)).not.toThrow();
  });

  it("merges with existing settings without overwriting user additions", async () => {
    // Write existing settings with user data
    const claudeDir = path.join(tmpDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });
    const existingSettings = {
      userCustomKey: "user-value",
      permissions: {
        allow: ["Bash(npm test)"],
      },
    };
    await fs.writeFile(
      path.join(claudeDir, "settings.json"),
      JSON.stringify(existingSettings, null, 2),
    );

    const config = makeMergedConfig();
    const hooksOutput = makeHooksOutput();

    await generateSettings({ projectDir: tmpDir, config, hooksOutput });

    const settings = JSON.parse(
      await fs.readFile(path.join(claudeDir, "settings.json"), "utf-8"),
    );

    // User additions preserved
    expect(settings.userCustomKey).toBe("user-value");
    // Managed permissions added (not wiping user's allow)
    expect(settings.permissions.allow).toContain("Bash(pnpm test*)");
    expect(settings.permissions.deny).toContain("Bash(rm -rf /)");
  });

  it("removes managed permissions that were removed from harness.yaml", async () => {
    const hooksOutput = makeHooksOutput();

    // 1st sync: allow has Bash(npm*)
    const config1 = makeMergedConfig({
      settings: {
        permissions: {
          allow: ["Bash(npm*)"],
          deny: [],
        },
      },
    });
    await generateSettings({ projectDir: tmpDir, config: config1, hooksOutput });

    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    const after1 = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    expect(after1.permissions.allow).toContain("Bash(npm*)");

    // 2nd sync: allow is now empty (Bash(npm*) removed from harness.yaml)
    const config2 = makeMergedConfig({
      settings: {
        permissions: {
          allow: [],
          deny: [],
        },
      },
    });
    await generateSettings({ projectDir: tmpDir, config: config2, hooksOutput });

    const after2 = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    // Bash(npm*) was managed, so it should be removed
    expect(after2.permissions.allow).not.toContain("Bash(npm*)");
  });

  it("preserves user-added permissions when managed permissions change", async () => {
    const hooksOutput = makeHooksOutput();
    const claudeDir = path.join(tmpDir, ".claude");

    // 1st sync: managed allow has Bash(npm*)
    const config1 = makeMergedConfig({
      settings: {
        permissions: {
          allow: ["Bash(npm*)"],
          deny: ["Bash(rm*)"],
        },
      },
    });
    await generateSettings({ projectDir: tmpDir, config: config1, hooksOutput });

    // User manually adds their own permission to settings.json
    const settingsPath = path.join(claudeDir, "settings.json");
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    settings.permissions.allow.push("Bash(git push)");
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");

    // 2nd sync: managed allow changes (removes npm*, adds pnpm*)
    const config2 = makeMergedConfig({
      settings: {
        permissions: {
          allow: ["Bash(pnpm*)"],
          deny: [],
        },
      },
    });
    await generateSettings({ projectDir: tmpDir, config: config2, hooksOutput });

    const after = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    // User-added permission preserved
    expect(after.permissions.allow).toContain("Bash(git push)");
    // New managed permission added
    expect(after.permissions.allow).toContain("Bash(pnpm*)");
    // Old managed permission removed
    expect(after.permissions.allow).not.toContain("Bash(npm*)");
    // Old managed deny removed
    expect(after.permissions.deny).not.toContain("Bash(rm*)");
  });

  it("handles missing _ohMyHarness.managedPermissions gracefully (backward compat)", async () => {
    const hooksOutput = makeHooksOutput();
    const claudeDir = path.join(tmpDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });

    // Existing settings without managedPermissions (legacy)
    const legacySettings = {
      permissions: {
        allow: ["Bash(npm test)", "Bash(legacy*)"],
        deny: [],
      },
      _ohMyHarness: {
        managedAt: "2024-01-01T00:00:00.000Z",
        presets: ["_base"],
      },
    };
    await fs.writeFile(
      path.join(claudeDir, "settings.json"),
      JSON.stringify(legacySettings, null, 2) + "\n",
    );

    // Sync with new config
    const config = makeMergedConfig({
      settings: {
        permissions: {
          allow: ["Bash(pnpm test*)"],
          deny: [],
        },
      },
    });
    await generateSettings({ projectDir: tmpDir, config, hooksOutput });

    const settingsPath = path.join(claudeDir, "settings.json");
    const after = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    // Legacy permissions preserved (treated as user-added since no managedPermissions existed)
    expect(after.permissions.allow).toContain("Bash(npm test)");
    expect(after.permissions.allow).toContain("Bash(legacy*)");
    // New managed permission added
    expect(after.permissions.allow).toContain("Bash(pnpm test*)");
  });

  it("tolerates malformed existing permission fields without breaking sync", async () => {
    const hooksOutput = makeHooksOutput();
    const claudeDir = path.join(tmpDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });

    const malformedSettings = {
      permissions: {
        allow: "Bash(npm test)",
        deny: ["Bash(rm -rf /)", 123, null],
      },
      _ohMyHarness: {
        managedAt: "2024-01-01T00:00:00.000Z",
        presets: ["_base"],
        managedPermissions: {
          allow: "Bash(old*)",
          deny: ["Bash(rm -rf /)", false],
        },
      },
    };
    await fs.writeFile(
      path.join(claudeDir, "settings.json"),
      JSON.stringify(malformedSettings, null, 2) + "\n",
    );

    await expect(
      generateSettings({ projectDir: tmpDir, config: makeMergedConfig(), hooksOutput }),
    ).resolves.not.toThrow();

    const after = JSON.parse(await fs.readFile(path.join(claudeDir, "settings.json"), "utf-8"));
    expect(after.permissions.allow).toEqual(["Bash(pnpm test*)"]);
    expect(after.permissions.deny).toEqual(["Bash(rm -rf /)"]);
  });

  it("preserves pre-existing user permissions even when they temporarily overlap with managed ones", async () => {
    const hooksOutput = makeHooksOutput();
    const claudeDir = path.join(tmpDir, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, "settings.json");

    const existingSettings = {
      permissions: {
        allow: ["Bash(git push)"],
        deny: [],
      },
      _ohMyHarness: {
        managedAt: "2024-01-01T00:00:00.000Z",
        presets: ["_base"],
        managedPermissions: {
          allow: [],
          deny: [],
        },
      },
    };
    await fs.writeFile(settingsPath, JSON.stringify(existingSettings, null, 2) + "\n");

    await generateSettings({
      projectDir: tmpDir,
      config: makeMergedConfig({
        settings: {
          permissions: {
            allow: ["Bash(git push)", "Bash(pnpm test*)"],
            deny: [],
          },
        },
      }),
      hooksOutput,
    });

    const afterFirstSync = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    expect(afterFirstSync.permissions.allow).toContain("Bash(git push)");
    expect(afterFirstSync._ohMyHarness.managedPermissions.allow).toEqual(["Bash(pnpm test*)"]);

    await generateSettings({
      projectDir: tmpDir,
      config: makeMergedConfig({
        settings: {
          permissions: {
            allow: ["Bash(pnpm test*)"],
            deny: [],
          },
        },
      }),
      hooksOutput,
    });

    const afterSecondSync = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    expect(afterSecondSync.permissions.allow).toContain("Bash(git push)");
    expect(afterSecondSync.permissions.allow).toContain("Bash(pnpm test*)");
  });

  it("is idempotent — running twice with same config produces identical output", async () => {
    const config = makeMergedConfig();
    const hooksOutput = makeHooksOutput();

    await generateSettings({ projectDir: tmpDir, config, hooksOutput });
    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    const first = await fs.readFile(settingsPath, "utf-8");

    // Force a different timestamp by waiting
    await new Promise((r) => setTimeout(r, 50));

    await generateSettings({ projectDir: tmpDir, config, hooksOutput });
    const second = await fs.readFile(settingsPath, "utf-8");

    expect(first).toBe(second);
  });
});
