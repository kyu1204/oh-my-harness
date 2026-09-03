import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { createPkce, buildOpenrouterAuthUrl, exchangeOpenrouterCode } from "../../src/nl/providers/openrouter-oauth.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openrouter PKCE helpers", () => {
  it("creates a verifier whose S256 challenge matches", () => {
    const { verifier, challenge } = createPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
  });

  it("builds a headless auth URL without a callback", () => {
    const url = new URL(buildOpenrouterAuthUrl("abc123"));
    expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
    expect(url.searchParams.get("code_challenge")).toBe("abc123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("key_label")).toBe("oh-my-harness");
    expect(url.searchParams.has("callback_url")).toBe(false);
  });

  it("exchanges the pasted code for an API key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ key: "sk-or-v1-xyz" }), { status: 200 })),
    );

    const key = await exchangeOpenrouterCode("the-code", "the-verifier");

    expect(key).toBe("sk-or-v1-xyz");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/auth/keys");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      code: "the-code",
      code_verifier: "the-verifier",
      code_challenge_method: "S256",
    });
  });

  it("throws a readable error when the exchange fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("expired", { status: 403 })));

    await expect(exchangeOpenrouterCode("bad", "v")).rejects.toThrow("403");
  });
});
