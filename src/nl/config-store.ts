import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export interface ProviderConfig {
  provider: "claude" | "openai" | "gemini" | "codex" | "openrouter" | "openai-compatible";
  method: "cli" | "api" | "oauth" | "oauth-api";
  apiKey?: string;
  model?: string;
  cliCommand?: string;
  /** OpenAI-compatible endpoint root, e.g. http://localhost:11434/v1 (openai-compatible only). */
  baseUrl?: string;
}

export function getConfigDir(): string {
  const home = process.env.HOME ?? os.homedir();
  return path.join(home, ".omh");
}

function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

export async function hasProviderConfig(): Promise<boolean> {
  try {
    await fs.access(getConfigPath());
    return true;
  } catch {
    return false;
  }
}

export async function loadProviderConfig(): Promise<ProviderConfig | undefined> {
  try {
    const raw = await fs.readFile(getConfigPath(), "utf-8");
    const parsed = JSON.parse(raw) as Omit<ProviderConfig, "provider"> & { provider: string };
    // Legacy: "codex-oauth-api" used to be its own provider; it is now codex + oauth-api.
    if (parsed.provider === "codex-oauth-api") {
      return { ...parsed, provider: "codex", method: "oauth-api" };
    }
    return parsed as ProviderConfig;
  } catch {
    return undefined;
  }
}

export async function saveProviderConfig(config: ProviderConfig): Promise<void> {
  const dir = getConfigDir();
  await fs.mkdir(dir, { recursive: true });
  const configPath = getConfigPath();
  const payload = JSON.stringify(config, null, 2) + "\n";
  await fs.writeFile(configPath, payload, { encoding: "utf-8", mode: 0o600 });
  await fs.chmod(configPath, 0o600);
}

export async function deleteProviderConfig(): Promise<void> {
  await fs.rm(getConfigPath(), { force: true });
}

/**
 * Masks an API key for display, keeping a short prefix and suffix so the user
 * can recognize which key is stored without revealing it. Keys short enough
 * that a prefix/suffix would overlap are masked entirely.
 */
export function maskApiKey(apiKey: string | undefined): string {
  const key = apiKey?.trim() ?? "";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}
