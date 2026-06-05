import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("codex-oauth-api provider", () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "omh-codex-oauth-api-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    process.env.HOME = originalHome;
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  async function writeCodexAuth(tokens: Record<string, unknown>): Promise<string> {
    const codexHome = path.join(tmpHome, ".codex");
    await fs.mkdir(codexHome, { recursive: true });
    const authPath = path.join(codexHome, "auth.json");
    await fs.writeFile(
      authPath,
      JSON.stringify({ OPENAI_API_KEY: null, tokens, last_refresh: "2026-01-01T00:00:00.000Z" }, null, 2),
      { encoding: "utf-8", mode: 0o600 },
    );
    return authPath;
  }

  it("calls the Codex backend Responses endpoint with the saved OAuth access token", async () => {
    await writeCodexAuth({
      access_token: "fake-access-token",
      refresh_token: "fake-refresh-token",
      account_id: "account-test",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          [
            'data: {"type":"response.output_text.delta","delta":"hello"}',
            'data: {"type":"response.output_text.delta","delta":" world"}',
            "data: [DONE]",
            "",
          ].join("\n"),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      ),
    );

    const { createCodexOauthApiProvider } = await import("../../src/nl/providers/codex-oauth-api.js");
    const provider = createCodexOauthApiProvider({ model: "gpt-5.5" });

    await expect(provider.run("Say hello")).resolves.toBe("hello world");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "Authorization": "Bearer fake-access-token",
      "ChatGPT-Account-ID": "account-test",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(init?.body)) as {
      model?: string;
      stream?: boolean;
      store?: boolean;
      instructions?: string;
      input?: Array<{ role?: string; content?: Array<{ text?: string }> }>;
    };
    expect(body.model).toBe("gpt-5.5");
    expect(body.stream).toBe(true);
    expect(body.store).toBe(false);
    expect(body.instructions).toContain("concise");
    expect(body.input?.[0]?.content?.[0]?.text).toBe("Say hello");
  });

  it("refreshes with the saved refresh token on 401 and persists the new access token without logging it", async () => {
    const authPath = await writeCodexAuth({
      access_token: "expired-access-token",
      refresh_token: "fake-refresh-token",
      account_id: "account-test",
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "new-access-token",
            refresh_token: "new-refresh-token",
            id_token: "new-id-token",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ output_text: "refreshed ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { createCodexOauthApiProvider } = await import("../../src/nl/providers/codex-oauth-api.js");
    const provider = createCodexOauthApiProvider({ model: "gpt-5.5" });

    await expect(provider.run("retry")).resolves.toBe("refreshed ok");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("https://auth.openai.com/oauth/token");
    expect(fetchMock.mock.calls[2][1]?.headers).toMatchObject({
      "Authorization": "Bearer new-access-token",
    });
    const saved = JSON.parse(await fs.readFile(authPath, "utf-8")) as {
      tokens?: { access_token?: string; refresh_token?: string };
    };
    expect(saved.tokens?.access_token).toBe("new-access-token");
    expect(saved.tokens?.refresh_token).toBe("new-refresh-token");
  });

  it("fails with a login hint when Codex OAuth credentials are missing", async () => {
    const { createCodexOauthApiProvider } = await import("../../src/nl/providers/codex-oauth-api.js");
    const provider = createCodexOauthApiProvider({ model: "gpt-5.5" });

    await expect(provider.run("test")).rejects.toThrow("codex login");
  });
});
