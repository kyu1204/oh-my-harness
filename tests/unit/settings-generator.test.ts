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
