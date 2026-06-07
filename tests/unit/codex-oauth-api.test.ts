import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("codex-oauth-api provider", () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  let originalCodexAccessToken: string | undefined;
  let originalCodexApiKey: string | undefined;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "omh-codex-oauth-api-"));
    originalHome = process.env.HOME;
    originalCodexAccessToken = process.env.CODEX_ACCESS_TOKEN;
    originalCodexApiKey = process.env.CODEX_API_KEY;
    process.env.HOME = tmpHome;
    delete process.env.CODEX_ACCESS_TOKEN;
    delete process.env.CODEX_API_KEY;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    process.env.HOME = originalHome;
    if (originalCodexAccessToken === undefined) delete process.env.CODEX_ACCESS_TOKEN;
    else process.env.CODEX_ACCESS_TOKEN = originalCodexAccessToken;
    if (originalCodexApiKey === undefined) delete process.env.CODEX_API_KEY;
    else process.env.CODEX_API_KEY = originalCodexApiKey;
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  async function writeOmhAuth(tokens: Record<string, unknown>): Promise<string> {
    const omhHome = path.join(tmpHome, ".omh");
    await fs.mkdir(omhHome, { recursive: true });
    const authPath = path.join(omhHome, "codex-oauth-api-auth.json");
    await fs.writeFile(
      authPath,
      JSON.stringify({ provider: "codex-oauth-api", tokens, last_refresh: "2026-01-01T00:00:00.000Z" }, null, 2),
      { encoding: "utf-8", mode: 0o600 },
    );
    return authPath;
  }

  async function writeCodexCliAuth(tokens: Record<string, unknown>): Promise<string> {
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

  it("calls the Codex backend Responses endpoint with the saved ~/.omh OAuth access token", async () => {
    await writeOmhAuth({
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

  it("imports Codex CLI auth into ~/.omh, refreshes with form encoding, and never rewrites ~/.codex/auth.json", async () => {
    const cliAuthPath = await writeCodexCliAuth({
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

    const { createCodexOauthApiProvider, getCodexOauthApiAuthPath } = await import("../../src/nl/providers/codex-oauth-api.js");
    const provider = createCodexOauthApiProvider({ model: "gpt-5.5" });

    await expect(provider.run("retry")).resolves.toBe("refreshed ok");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("https://auth.openai.com/oauth/token");
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    const refreshBody = fetchMock.mock.calls[1][1]?.body;
    expect(String(refreshBody)).toContain("grant_type=refresh_token");
    expect(String(refreshBody)).toContain("refresh_token=fake-refresh-token");
    expect(fetchMock.mock.calls[2][1]?.headers).toMatchObject({
      "Authorization": "Bearer new-access-token",
    });

    const omhSaved = JSON.parse(await fs.readFile(getCodexOauthApiAuthPath(), "utf-8")) as {
      tokens?: { access_token?: string; refresh_token?: string };
    };
    expect(omhSaved.tokens?.access_token).toBe("new-access-token");
    expect(omhSaved.tokens?.refresh_token).toBe("new-refresh-token");

    const cliSaved = JSON.parse(await fs.readFile(cliAuthPath, "utf-8")) as {
      tokens?: { access_token?: string; refresh_token?: string };
    };
    expect(cliSaved.tokens?.access_token).toBe("expired-access-token");
    expect(cliSaved.tokens?.refresh_token).toBe("fake-refresh-token");
  });

  it("prefers the ~/.omh auth store over a stale Codex CLI cache", async () => {
    await writeOmhAuth({ access_token: "omh-access-token", refresh_token: "omh-refresh-token" });
    await writeCodexCliAuth({ access_token: "cli-access-token", refresh_token: "cli-refresh-token" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ output_text: "ok" }), { status: 200 })),
    );

    const { createCodexOauthApiProvider } = await import("../../src/nl/providers/codex-oauth-api.js");
    const provider = createCodexOauthApiProvider({ model: "gpt-5.5" });

    await expect(provider.run("test")).resolves.toBe("ok");
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({
      "Authorization": "Bearer omh-access-token",
    });
  });

  it("runs the direct Codex device-code OAuth flow and stores tokens under ~/.omh", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ device_auth_id: "device-1", user_code: "ABCD-EFGH", interval: "0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response("pending", { status: 403 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ authorization_code: "auth-code", code_verifier: "verifier" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "device-access", refresh_token: "device-refresh", expires_in: 3600 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const instructions: Array<{ url: string; code: string }> = [];

    const { loginCodexOauthApi, getCodexOauthApiAuthPath } = await import("../../src/nl/providers/codex-oauth-api.js");
    await expect(loginCodexOauthApi({ pollIntervalMs: 0, onDeviceCode: (info) => instructions.push(info) })).resolves.toMatchObject({
      accessToken: "device-access",
      refreshToken: "device-refresh",
    });

    expect(instructions).toEqual([{ url: "https://auth.openai.com/codex/device", code: "ABCD-EFGH" }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://auth.openai.com/api/accounts/deviceauth/usercode");
    expect(fetchMock.mock.calls[2][0]).toBe("https://auth.openai.com/api/accounts/deviceauth/token");
    expect(fetchMock.mock.calls[3][0]).toBe("https://auth.openai.com/oauth/token");
    expect(fetchMock.mock.calls[3][1]?.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(String(fetchMock.mock.calls[3][1]?.body)).toContain("grant_type=authorization_code");
    expect(String(fetchMock.mock.calls[3][1]?.body)).toContain("code=auth-code");

    const saved = JSON.parse(await fs.readFile(getCodexOauthApiAuthPath(), "utf-8")) as {
      tokens?: { access_token?: string; refresh_token?: string };
    };
    expect(saved.tokens?.access_token).toBe("device-access");
    expect(saved.tokens?.refresh_token).toBe("device-refresh");
  });

  it("fails with an omh config login hint when Codex OAuth credentials are missing", async () => {
    const { createCodexOauthApiProvider } = await import("../../src/nl/providers/codex-oauth-api.js");
    const provider = createCodexOauthApiProvider({ model: "gpt-5.5" });

    await expect(provider.run("test")).rejects.toThrow("omh config");
  });
});
