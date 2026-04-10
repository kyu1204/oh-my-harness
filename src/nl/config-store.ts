import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export interface ProviderConfig {
  provider: "claude" | "openai" | "gemini";
  method: "cli" | "api";
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
