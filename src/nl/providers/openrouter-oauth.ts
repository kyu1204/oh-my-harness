import { createHash, randomBytes } from "node:crypto";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const AUTH_URL = "https://openrouter.ai/auth";
const KEY_EXCHANGE_URL = `${OPENROUTER_BASE_URL}/auth/keys`;
const APP_LABEL = "oh-my-harness";

/**
 * OpenRouter PKCE in headless mode: no callback server. The user opens the URL,
 * approves, copies the code shown on screen, and we exchange it for a normal
 * API key (which is then stored like any other key).
 * Docs: https://openrouter.ai/docs/guides/overview/auth/oauth
 */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildOpenrouterAuthUrl(challenge: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("key_label", APP_LABEL);
  return url.toString();
}

export async function exchangeOpenrouterCode(code: string, verifier: string): Promise<string> {
  const response = await fetch(KEY_EXCHANGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.trim(), code_verifier: verifier, code_challenge_method: "S256" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`OpenRouter key exchange failed (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as { key?: string };
  if (!data.key) throw new Error("OpenRouter key exchange returned no key");
  return data.key;
}
