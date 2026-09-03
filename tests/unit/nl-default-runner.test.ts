import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProviderConfig } from "../../src/nl/config-store.js";

const loadProviderConfig = vi.fn<() => Promise<ProviderConfig | undefined>>();
const createProvider = vi.fn((config: ProviderConfig) => ({
  name: config.provider,
  run: async () => `ran:${config.provider}:${config.model ?? ""}`,
}));

vi.mock("../../src/nl/config-store.js", () => ({
  loadProviderConfig: () => loadProviderConfig(),
}));
vi.mock("../../src/nl/provider-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/nl/provider-registry.js")>();
  return { ...actual, createProvider: (c: ProviderConfig) => createProvider(c) };
});

const ENV_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY"];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  loadProviderConfig.mockReset();
  createProvider.mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("createDefaultRunner", () => {
  it("prefers the saved ~/.omh config over environment variables", async () => {
    loadProviderConfig.mockResolvedValue({ provider: "gemini", method: "api", apiKey: "g", model: "gemini-2.5-pro" });
    process.env.OPENAI_API_KEY = "sk-env";
    const { createDefaultRunner } = await import("../../src/nl/parse-intent.js");

    const runner = await createDefaultRunner();

    expect(await runner("x")).toBe("ran:gemini:gemini-2.5-pro");
  });

  it("falls back to ANTHROPIC_API_KEY when nothing is saved", async () => {
    loadProviderConfig.mockResolvedValue(undefined);
    process.env.ANTHROPIC_API_KEY = "sk-ant";
    const { createDefaultRunner } = await import("../../src/nl/parse-intent.js");

    await createDefaultRunner();

    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claude", method: "api", apiKey: "sk-ant" }),
    );
  });

  it("falls back to OPENAI_API_KEY, then GEMINI_API_KEY / GOOGLE_API_KEY", async () => {
    loadProviderConfig.mockResolvedValue(undefined);
    const { createDefaultRunner } = await import("../../src/nl/parse-intent.js");

    process.env.OPENAI_API_KEY = "sk-o";
    await createDefaultRunner();
    expect(createProvider).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "openai", apiKey: "sk-o" }));

    delete process.env.OPENAI_API_KEY;
    process.env.GOOGLE_API_KEY = "g-key";
    await createDefaultRunner();
    expect(createProvider).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "gemini", apiKey: "g-key" }));

    delete process.env.GOOGLE_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or";
    await createDefaultRunner();
    expect(createProvider).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "openrouter", apiKey: "sk-or" }));
  });

  it("falls back to the claude CLI when neither config nor env keys exist", async () => {
    loadProviderConfig.mockResolvedValue(undefined);
    const { createDefaultRunner } = await import("../../src/nl/parse-intent.js");

    const runner = await createDefaultRunner();

    expect(createProvider).not.toHaveBeenCalled();
    expect(typeof runner).toBe("function");
  });
});
