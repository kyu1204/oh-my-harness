import { describe, it, expect, vi, afterEach } from "vitest";
import { createOpenaiApiProvider } from "../../src/nl/providers/openai-api.js";

describe("openai-api provider", () => {
  it("creates a provider with name 'openai'", () => {
    const provider = createOpenaiApiProvider("fake-key", "gpt-4o");
    expect(provider.name).toBe("openai");
    expect(typeof provider.run).toBe("function");
  });

  it("defaults requests to gpt-5.6-sol when no model is configured", async () => {
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
    expect(body.model).toBe("gpt-5.6-sol");
  });

  it("targets a custom base URL, sends max_tokens and omits Authorization when no key is given", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const provider = createOpenaiApiProvider("", "llama3.2", {
      baseUrl: "http://localhost:11434/v1/",
      name: "openai-compatible",
      headers: { "X-Extra": "1" },
    });
    expect(provider.name).toBe("openai-compatible");
    await expect(provider.run("hello")).resolves.toBe("ok");

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers["X-Extra"]).toBe("1");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.max_tokens).toBe(4096);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it("keeps max_completion_tokens and the bearer header for api.openai.com", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await createOpenaiApiProvider("sk-x", "gpt-5.5").run("hi");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-x");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.max_completion_tokens).toBe(4096);
    expect(body.max_tokens).toBeUndefined();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
