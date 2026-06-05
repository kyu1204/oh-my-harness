import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { configCommand } from "../../src/cli/commands/config.js";
import { saveProviderConfig, hasProviderConfig } from "../../src/nl/config-store.js";
import type { ProviderConfig } from "../../src/nl/config-store.js";

let tmpHome: string;
let originalHome: string;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

function loggedOutput(): string {
  return consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n");
}

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "omh-config-cmd-"));
  originalHome = process.env.HOME ?? "";
  process.env.HOME = tmpHome;
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.env.HOME = originalHome;
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe("configCommand --show", () => {
  it("prints provider, method and model with the API key masked", async () => {
    await saveProviderConfig({
      provider: "openai",
      method: "api",
      apiKey: "sk-1234567890abcdef",
      model: "gpt-5.4",
    });

    const result = await configCommand({ show: true });

    expect(result.exitCode).toBe(0);
    const out = loggedOutput();
    expect(out).toContain("openai");
    expect(out).toContain("gpt-5.4");
    expect(out).toContain("sk-…cdef");
    // The raw key must never be printed.
    expect(out).not.toContain("sk-1234567890abcdef");
  });

  it("reports when no provider is configured", async () => {
    const result = await configCommand({ show: true });

    expect(result.exitCode).toBe(0);
    expect(loggedOutput().toLowerCase()).toContain("no ai provider");
  });

  it("prints Codex OAuth config without asking for or leaking an API key", async () => {
    await saveProviderConfig({
      provider: "codex",
      method: "oauth",
      cliCommand: "codex",
      model: "gpt-5.4",
    });

    const result = await configCommand({ show: true });

    expect(result.exitCode).toBe(0);
    const out = loggedOutput();
    expect(out).toContain("codex");
    expect(out).toContain("oauth");
    expect(out).toContain("gpt-5.4");
    expect(out).toContain("codex login");
    expect(out.toLowerCase()).not.toContain("api key");
  });

  it("prints Codex OAuth API config without asking for or leaking an API key", async () => {
    await saveProviderConfig({
      provider: "codex-oauth-api",
      method: "oauth-api",
      model: "gpt-5.5",
    });

    const result = await configCommand({ show: true });

    expect(result.exitCode).toBe(0);
    const out = loggedOutput();
    expect(out).toContain("codex-oauth-api");
    expect(out).toContain("oauth-api");
    expect(out).toContain("gpt-5.5");
    expect(out).toContain("~/.codex/auth.json");
    expect(out.toLowerCase()).not.toContain("api key");
  });
});

describe("configCommand --reset", () => {
  it("deletes the saved config when confirmed", async () => {
    await saveProviderConfig({ provider: "openai", method: "api", apiKey: "sk-secret" });

    const result = await configCommand({ reset: true, yes: true });

    expect(result.exitCode).toBe(0);
    expect(await hasProviderConfig()).toBe(false);
  });

  it("keeps the config when the user declines", async () => {
    await saveProviderConfig({ provider: "openai", method: "api", apiKey: "sk-secret" });

    const result = await configCommand({
      reset: true,
      confirm: async () => false,
    });

    expect(result.exitCode).toBe(0);
    expect(await hasProviderConfig()).toBe(true);
  });

  it("reports when there is nothing to reset", async () => {
    const result = await configCommand({ reset: true, yes: true });

    expect(result.exitCode).toBe(0);
    expect(loggedOutput().toLowerCase()).toContain("no ai provider");
  });
});

describe("configCommand (reconfigure)", () => {
  it("runs the provider setup and persists the new config", async () => {
    await saveProviderConfig({ provider: "claude", method: "cli", cliCommand: "claude" });

    const newConfig: ProviderConfig = {
      provider: "gemini",
      method: "api",
      apiKey: "key-abcd1234efgh",
      model: "gemini-2.5-pro",
    };
    const setupRunner = vi.fn(async () => {
      await saveProviderConfig(newConfig);
      return newConfig;
    });

    const result = await configCommand({ setupRunner });

    expect(result.exitCode).toBe(0);
    expect(setupRunner).toHaveBeenCalledOnce();
    const { loadProviderConfig } = await import("../../src/nl/config-store.js");
    expect(await loadProviderConfig()).toEqual(newConfig);
  });

  it("exits cleanly when setup is cancelled", async () => {
    await saveProviderConfig({ provider: "claude", method: "cli", cliCommand: "claude" });

    const setupRunner = vi.fn(async () => undefined);
    const result = await configCommand({ setupRunner });

    expect(result.exitCode).toBe(0);
    expect(setupRunner).toHaveBeenCalledOnce();
  });
});

describe("configCommand mutually exclusive flags", () => {
  it("errors when --show and --reset are used together, without touching the config", async () => {
    await saveProviderConfig({ provider: "openai", method: "api", apiKey: "sk-secret" });

    const result = await configCommand({ show: true, reset: true, yes: true });

    // Conflicting intent must fail loudly rather than silently picking one.
    expect(result.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
    const errOut = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errOut).toContain("--show");
    expect(errOut).toContain("--reset");
    // Neither branch ran: config is untouched and nothing was printed to stdout.
    expect(await hasProviderConfig()).toBe(true);
    expect(loggedOutput()).toBe("");
  });
});
