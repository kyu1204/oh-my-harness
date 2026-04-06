import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  loadProviderConfig,
  saveProviderConfig,
  hasProviderConfig,
  getConfigDir,
  type ProviderConfig,
} from "../../src/nl/config-store.js";

let tmpHome: string;
let originalHome: string;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "omh-config-"));
  originalHome = process.env.HOME ?? "";
  process.env.HOME = tmpHome;
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe("config-store", () => {
  it("getConfigDir returns ~/.omh", () => {
    expect(getConfigDir()).toBe(path.join(tmpHome, ".omh"));
  });

  it("hasProviderConfig returns false when no config exists", async () => {
    expect(await hasProviderConfig()).toBe(false);
  });

  it("saveProviderConfig creates ~/.omh/config.json", async () => {
    const config: ProviderConfig = {
      provider: "claude",
      method: "cli",
      cliCommand: "claude",
    };

    await saveProviderConfig(config);

    const configPath = path.join(tmpHome, ".omh", "config.json");
    const raw = await fs.readFile(configPath, "utf-8");
    const saved = JSON.parse(raw);
    expect(saved.provider).toBe("claude");
    expect(saved.method).toBe("cli");
  });

  it("loadProviderConfig reads saved config", async () => {
    const config: ProviderConfig = {
      provider: "openai",
      method: "api",
      apiKey: "sk-test-123",
      model: "gpt-4o",
    };

    await saveProviderConfig(config);
    const loaded = await loadProviderConfig();

    expect(loaded).toBeDefined();
    expect(loaded!.provider).toBe("openai");
    expect(loaded!.method).toBe("api");
    expect(loaded!.apiKey).toBe("sk-test-123");
    expect(loaded!.model).toBe("gpt-4o");
  });

  it("hasProviderConfig returns true after save", async () => {
    await saveProviderConfig({
      provider: "gemini",
      method: "api",
      apiKey: "key",
    });
    expect(await hasProviderConfig()).toBe(true);
  });

  it("loadProviderConfig returns undefined when no config exists", async () => {
    const loaded = await loadProviderConfig();
    expect(loaded).toBeUndefined();
  });

  it("saveProviderConfig overwrites existing config", async () => {
    await saveProviderConfig({ provider: "claude", method: "cli", cliCommand: "claude" });
    await saveProviderConfig({ provider: "openai", method: "api", apiKey: "sk-new" });

    const loaded = await loadProviderConfig();
    expect(loaded!.provider).toBe("openai");
  });
});
