import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LLMProvider } from "../provider-registry.js";

const DEFAULT_MODEL = "gpt-5.5";
const RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;

export interface CodexOauthApiProviderOptions {
  model?: string;
  authPath?: string;
  responsesUrl?: string;
  timeoutMs?: number;
}

interface CodexAuthFile {
  OPENAI_API_KEY?: string | null;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

interface AuthState {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  accountId?: string;
  authPath?: string;
  authFile?: CodexAuthFile;
}

function getCodexAuthPath(): string {
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(process.env.HOME ?? os.homedir(), ".codex");
  return path.join(codexHome, "auth.json");
}

function decodeJwtPayload(token: string | undefined): Record<string, unknown> | undefined {
  const payload = token?.split(".")[1];
  if (!payload) return undefined;
  try {
    const padded = `${payload}${"=".repeat((4 - (payload.length % 4)) % 4)}`;
    return JSON.parse(Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function readNestedAccountId(payload: Record<string, unknown> | undefined): string | undefined {
  if (!payload) return undefined;
  const authClaim = payload["https://api.openai.com/auth"];
  const nested = authClaim && typeof authClaim === "object"
    ? (authClaim as { chatgpt_account_id?: unknown }).chatgpt_account_id
    : undefined;
  const dotted = payload["https://api.openai.com/auth.chatgpt_account_id"];
  const direct = payload.chatgpt_account_id;
  const orgs = payload.organizations;
  const firstOrg = Array.isArray(orgs) ? (orgs[0] as { id?: unknown } | undefined)?.id : undefined;
  const candidate = nested ?? dotted ?? direct ?? firstOrg;
  return typeof candidate === "string" && candidate.trim() ? candidate : undefined;
}

function extractAccountId(tokens: CodexAuthFile["tokens"]): string | undefined {
  return tokens?.account_id
    ?? readNestedAccountId(decodeJwtPayload(tokens?.id_token))
    ?? readNestedAccountId(decodeJwtPayload(tokens?.access_token));
}

async function loadAuthState(authPath: string): Promise<AuthState> {
  const envToken = process.env.CODEX_ACCESS_TOKEN?.trim() || process.env.CODEX_API_KEY?.trim();
  if (envToken) {
    return {
      accessToken: envToken,
      accountId: readNestedAccountId(decodeJwtPayload(envToken)),
    };
  }

  let authFile: CodexAuthFile;
  try {
    authFile = JSON.parse(await fs.readFile(authPath, "utf-8")) as CodexAuthFile;
  } catch {
    throw new Error(`Codex OAuth API credentials not found. Run \`codex login\` first or set CODEX_ACCESS_TOKEN.`);
  }

  const accessToken = authFile.tokens?.access_token?.trim();
  if (!accessToken) {
    throw new Error(`Codex OAuth API access token missing. Run \`codex login\` first.`);
  }

  return {
    accessToken,
    refreshToken: authFile.tokens?.refresh_token,
    idToken: authFile.tokens?.id_token,
    accountId: extractAccountId(authFile.tokens),
    authPath,
    authFile,
  };
}

async function persistRefreshedAuth(state: AuthState, tokenResponse: {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
}): Promise<AuthState> {
  if (!state.authPath || !state.authFile || !tokenResponse.access_token) {
    return state;
  }

  const nextTokens = {
    ...state.authFile.tokens,
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token ?? state.refreshToken,
    id_token: tokenResponse.id_token ?? state.idToken,
  };
  const accountId = extractAccountId(nextTokens) ?? state.accountId;
  if (accountId) nextTokens.account_id = accountId;

  const nextAuth: CodexAuthFile = {
    ...state.authFile,
    tokens: nextTokens,
    last_refresh: new Date().toISOString(),
  };
  await fs.writeFile(state.authPath, `${JSON.stringify(nextAuth, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  await fs.chmod(state.authPath, 0o600);

  return {
    accessToken: tokenResponse.access_token,
    refreshToken: nextTokens.refresh_token,
    idToken: nextTokens.id_token,
    accountId,
    authPath: state.authPath,
    authFile: nextAuth,
  };
}

async function refreshAuth(state: AuthState, timeoutMs: number): Promise<AuthState> {
  if (!state.refreshToken) {
    throw new Error("Codex OAuth API token expired and no refresh token is available. Run `codex login` again.");
  }

  const response = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: state.refreshToken,
      scope: "openid profile email",
    }),
  }, timeoutMs);

  if (!response.ok) {
    throw new Error(`Codex OAuth token refresh failed (${response.status}): ${await response.text()}`);
  }

  const tokenResponse = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
  };
  if (!tokenResponse.access_token) {
    throw new Error("Codex OAuth token refresh returned no access token");
  }

  return persistRefreshedAuth(state, tokenResponse);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      throw new Error(`Codex OAuth API request timed out after ${Math.ceil(timeoutMs / 1000)} seconds`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function buildHeaders(state: AuthState): Record<string, string> {
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${state.accessToken}`,
    "Content-Type": "application/json",
    "Accept": "text/event-stream, application/json",
    "originator": "codex_cli_rs",
    "User-Agent": "codex_cli_rs/0.0.1",
  };
  if (state.accountId) {
    headers["ChatGPT-Account-ID"] = state.accountId;
  }
  return headers;
}

function buildBody(prompt: string, model: string): string {
  return JSON.stringify({
    model,
    instructions: "You are a concise assistant. Return only the requested answer.",
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ],
    store: false,
    stream: true,
  });
}

function extractTextFromJson(data: unknown): string {
  if (typeof data !== "object" || data === null) return "";
  const root = data as {
    output_text?: unknown;
    delta?: unknown;
    text?: unknown;
    response?: unknown;
    output?: unknown;
  };

  if (typeof root.output_text === "string") return root.output_text;
  if (typeof root.delta === "string") return root.delta;
  if (typeof root.text === "string") return root.text;
  if (root.response) {
    const nested = extractTextFromJson(root.response);
    if (nested) return nested;
  }

  const output = Array.isArray(root.output) ? root.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const outputItem = item as { text?: unknown; content?: unknown };
    if (typeof outputItem.text === "string") parts.push(outputItem.text);
    const content = Array.isArray(outputItem.content) ? outputItem.content : [];
    for (const contentItem of content) {
      if (typeof contentItem !== "object" || contentItem === null) continue;
      const maybeText = (contentItem as { text?: unknown; output_text?: unknown }).text
        ?? (contentItem as { output_text?: unknown }).output_text;
      if (typeof maybeText === "string") parts.push(maybeText);
    }
  }
  return parts.join("");
}

function parseResponseText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (!trimmed.includes("data:")) {
    return extractTextFromJson(JSON.parse(trimmed));
  }

  const deltas: string[] = [];
  let completedText = "";
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") continue;
    const event = JSON.parse(payload) as { type?: string; delta?: unknown; response?: unknown };
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      deltas.push(event.delta);
      continue;
    }
    if (event.type === "response.completed" && event.response) {
      completedText = extractTextFromJson(event.response);
    }
  }
  return deltas.join("") || completedText;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createCodexOauthApiProvider(options: CodexOauthApiProviderOptions = {}): LLMProvider {
  const model = options.model?.trim() || DEFAULT_MODEL;
  const responsesUrl = options.responsesUrl ?? RESPONSES_URL;
  const authPath = options.authPath ?? getCodexAuthPath();
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  return {
    name: "codex-oauth-api",
    run: async (prompt: string): Promise<string> => {
      let authState = await loadAuthState(authPath);
      let lastError: unknown;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const response = await fetchWithTimeout(responsesUrl, {
          method: "POST",
          headers: buildHeaders(authState),
          body: buildBody(prompt, model),
        }, timeoutMs);

        if (response.status === 401 && attempt === 1) {
          authState = await refreshAuth(authState, timeoutMs);
          continue;
        }

        if (!response.ok) {
          const body = await response.text();
          if (isRetryableStatus(response.status) && attempt < MAX_ATTEMPTS) {
            lastError = new Error(`Codex OAuth API error (${response.status}): ${body}`);
            await sleep(Math.pow(2, attempt - 1) * 1000);
            continue;
          }
          throw new Error(`Codex OAuth API error (${response.status}): ${body}`);
        }

        const text = parseResponseText(await response.text());
        if (!text) {
          throw new Error("Codex OAuth API returned no text content");
        }
        return text;
      }

      throw lastError ?? new Error("Codex OAuth API request failed after retries");
    },
  };
}
