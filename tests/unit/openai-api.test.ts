import { describe, it, expect, vi, afterEach } from "vitest";
import { createOpenaiApiProvider } from "../../src/nl/providers/openai-api.js";

describe("openai-api provider", () => {
  it("creates a provider with name 'openai'", () => {
    const provider = createOpenaiApiProvider("fake-key", "gpt-4o");
    expect(provider.name).toBe("openai");
    expect(typeof provider.run).toBe("function");
  });

  it("defaults requests to gpt-5.5 when no model is configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const provider = createOpenaiApiProvider("fake-key");
    await expect(provider.run("hello")).resolves.toBe("ok");

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)) as {
      model?: string;
    };
    expect(body.model).toBe("gpt-5.5");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
