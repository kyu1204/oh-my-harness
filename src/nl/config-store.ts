import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export interface ProviderConfig {
  provider: "claude" | "openai" | "gemini" | "codex";
  method: "cli" | "api" | "oauth";
  apiKey?: string;
  model?: string;
  cliCommand?: string;
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
    return JSON.parse(raw) as ProviderConfig;
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
