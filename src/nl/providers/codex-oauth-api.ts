import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getConfigDir } from "../config-store.js";
import type { LLMProvider } from "../provider-registry.js";

const DEFAULT_MODEL = "gpt-5.6-sol";
const ISSUER = "https://auth.openai.com";
const RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const TOKEN_URL = `${ISSUER}/oauth/token`;
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const AUTH_FILENAME = "codex-oauth-api-auth.json";

export interface CodexOauthApiProviderOptions {
  model?: string;
  authPath?: string;
  codexCliAuthPath?: string;
  responsesUrl?: string;
  timeoutMs?: number;
}

export interface CodexOauthApiLoginOptions {
  authPath?: string;
  issuer?: string;
  tokenUrl?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  onDeviceCode?: (info: { url: string; code: string }) => void | Promise<void>;
}

interface CodexAuthFile {
  provider?: string;
  source?: string;
  OPENAI_API_KEY?: string | null;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
  auth_mode?: string;
}

export interface AuthState {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  accountId?: string;
  authPath?: string;
  authFile?: CodexAuthFile;
}

export function getCodexOauthApiAuthPath(): string {
  return path.join(getConfigDir(), AUTH_FILENAME);
}

function getCodexCliAuthPath(): string {
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

async function readAuthFile(authPath: string): Promise<CodexAuthFile | undefined> {
  try {
    return JSON.parse(await fs.readFile(authPath, "utf-8")) as CodexAuthFile;
  } catch {
    return undefined;
  }
}

async function writeAuthFile(authPath: string, authFile: CodexAuthFile): Promise<void> {
  await fs.mkdir(path.dirname(authPath), { recursive: true });
  await fs.writeFile(authPath, `${JSON.stringify(authFile, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  await fs.chmod(authPath, 0o600);
}

function authStateFromFile(authFile: CodexAuthFile, authPath: string): AuthState | undefined {
  const accessToken = authFile.tokens?.access_token?.trim();
  if (!accessToken) return undefined;
  return {
    accessToken,
    refreshToken: authFile.tokens?.refresh_token,
    idToken: authFile.tokens?.id_token,
    accountId: extractAccountId(authFile.tokens),
    authPath,
    authFile,
  };
}

async function importCodexCliAuth(cliAuthPath: string, authPath: string): Promise<AuthState | undefined> {
  const cliAuth = await readAuthFile(cliAuthPath);
  const state = cliAuth ? authStateFromFile(cliAuth, authPath) : undefined;
  if (!state || !cliAuth?.tokens) return undefined;

  const nextAuth: CodexAuthFile = {
    provider: "codex-oauth-api",
    source: "codex-cli-import",
    auth_mode: "chatgpt",
    tokens: {
      ...cliAuth.tokens,
      account_id: extractAccountId(cliAuth.tokens),
    },
    last_refresh: new Date().toISOString(),
  };
  await writeAuthFile(authPath, nextAuth);
  return authStateFromFile(nextAuth, authPath);
}

async function loadAuthState(authPath: string, cliAuthPath: string): Promise<AuthState> {
  const envToken = process.env.CODEX_ACCESS_TOKEN?.trim() || process.env.CODEX_API_KEY?.trim();
  if (envToken) {
    return {
      accessToken: envToken,
      accountId: readNestedAccountId(decodeJwtPayload(envToken)),
    };
  }

  const omhAuth = await readAuthFile(authPath);
  const omhState = omhAuth ? authStateFromFile(omhAuth, authPath) : undefined;
  if (omhState) return omhState;

  const imported = await importCodexCliAuth(cliAuthPath, authPath);
  if (imported) return imported;

  throw new Error(
    `Codex OAuth API credentials not found. Run \`omh config\` and choose Codex OAuth API to sign in, ` +
      `or set CODEX_ACCESS_TOKEN.`,
  );
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
    provider: "codex-oauth-api",
    auth_mode: "chatgpt",
    tokens: nextTokens,
    last_refresh: new Date().toISOString(),
  };
  await writeAuthFile(state.authPath, nextAuth);

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
    throw new Error("Codex OAuth API token expired and no refresh token is available. Run `omh config` again.");
  }

  const response = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CODEX_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: state.refreshToken,
    }).toString(),
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

export function buildCodexHeaders(state: Pick<AuthState, "accessToken" | "accountId">): Record<string, string> {
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

async function parseJsonResponse<T>(response: Response, label: string): Promise<T> {
  try {
    return await response.json() as T;
  } catch (err) {
    throw new Error(`${label} returned invalid JSON: ${(err as Error).message}`);
  }
}

export async function loginCodexOauthApi(options: CodexOauthApiLoginOptions = {}): Promise<AuthState> {
  const authPath = options.authPath ?? getCodexOauthApiAuthPath();
  const issuer = (options.issuer ?? ISSUER).replace(/\/$/, "");
  const tokenUrl = options.tokenUrl ?? `${issuer}/oauth/token`;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxWaitMs = options.maxWaitMs ?? 15 * 60 * 1000;

  const deviceResponse = await fetchWithTimeout(`${issuer}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
  }, timeoutMs);
  if (!deviceResponse.ok) {
    throw new Error(`Codex device authorization failed (${deviceResponse.status}): ${await deviceResponse.text()}`);
  }
  const device = await parseJsonResponse<{
    device_auth_id?: string;
    user_code?: string;
    interval?: string | number;
  }>(deviceResponse, "Codex device authorization");
  const deviceAuthId = device.device_auth_id?.trim();
  const userCode = device.user_code?.trim();
  if (!deviceAuthId || !userCode) {
    throw new Error("Codex device authorization response was missing device_auth_id or user_code");
  }

  const deviceUrl = `${issuer}/codex/device`;
  await options.onDeviceCode?.({ url: deviceUrl, code: userCode });

  const parsedInterval = typeof device.interval === "number" ? device.interval : Number.parseInt(String(device.interval ?? "5"), 10);
  const pollIntervalMs = options.pollIntervalMs ?? Math.max(Number.isFinite(parsedInterval) ? parsedInterval : 5, 1) * 1000;
  const startedAt = Date.now();
  let authorizationCode = "";
  let codeVerifier = "";

  while (Date.now() - startedAt < maxWaitMs) {
    const pollResponse = await fetchWithTimeout(`${issuer}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
    }, timeoutMs);

    if (pollResponse.ok) {
      const poll = await parseJsonResponse<{
        authorization_code?: string;
        code_verifier?: string;
      }>(pollResponse, "Codex device authorization poll");
      authorizationCode = poll.authorization_code?.trim() ?? "";
      codeVerifier = poll.code_verifier?.trim() ?? "";
      break;
    }

    if (pollResponse.status !== 403 && pollResponse.status !== 404) {
      throw new Error(`Codex device authorization poll failed (${pollResponse.status}): ${await pollResponse.text()}`);
    }
    await sleep(pollIntervalMs);
  }

  if (!authorizationCode || !codeVerifier) {
    throw new Error("Codex device authorization timed out before sign-in completed");
  }

  const tokenResponse = await fetchWithTimeout(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authorizationCode,
      redirect_uri: `${issuer}/deviceauth/callback`,
      client_id: CODEX_CLIENT_ID,
      code_verifier: codeVerifier,
    }).toString(),
  }, timeoutMs);
  if (!tokenResponse.ok) {
    throw new Error(`Codex OAuth token exchange failed (${tokenResponse.status}): ${await tokenResponse.text()}`);
  }
  const tokens = await parseJsonResponse<{
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
  }>(tokenResponse, "Codex OAuth token exchange");
  if (!tokens.access_token) {
    throw new Error("Codex OAuth token exchange returned no access token");
  }

  const nextAuth: CodexAuthFile = {
    provider: "codex-oauth-api",
    source: "device-code",
    auth_mode: "chatgpt",
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      id_token: tokens.id_token,
    },
    last_refresh: new Date().toISOString(),
  };
  const accountId = extractAccountId(nextAuth.tokens);
  if (accountId && nextAuth.tokens) nextAuth.tokens.account_id = accountId;
  await writeAuthFile(authPath, nextAuth);

  const state = authStateFromFile(nextAuth, authPath);
  if (!state) throw new Error("Codex OAuth API login did not persist a usable access token");
  return state;
}

export async function ensureCodexOauthApiAuth(options: CodexOauthApiLoginOptions & { codexCliAuthPath?: string } = {}): Promise<AuthState> {
  const authPath = options.authPath ?? getCodexOauthApiAuthPath();
  try {
    return await loadAuthState(authPath, options.codexCliAuthPath ?? getCodexCliAuthPath());
  } catch {
    return loginCodexOauthApi({ ...options, authPath });
  }
}

export function createCodexOauthApiProvider(options: CodexOauthApiProviderOptions = {}): LLMProvider {
  const model = options.model?.trim() || DEFAULT_MODEL;
  const responsesUrl = options.responsesUrl ?? RESPONSES_URL;
  const authPath = options.authPath ?? getCodexOauthApiAuthPath();
  const codexCliAuthPath = options.codexCliAuthPath ?? getCodexCliAuthPath();
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  return {
    name: "codex-oauth-api",
    run: async (prompt: string): Promise<string> => {
      let authState = await loadAuthState(authPath, codexCliAuthPath);
      let lastError: unknown;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const response = await fetchWithTimeout(responsesUrl, {
          method: "POST",
          headers: buildCodexHeaders(authState),
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
