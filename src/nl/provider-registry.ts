import type { ProviderConfig } from "./config-store.js";
import { createClaudeCliProvider } from "./providers/claude-cli.js";
import { createClaudeApiProvider } from "./providers/claude-api.js";
import { createOpenaiApiProvider } from "./providers/openai-api.js";
import { createGeminiApiProvider } from "./providers/gemini-api.js";

export interface LLMProvider {
  name: string;
  run(prompt: string): Promise<string>;
}

export interface ProviderDefinition {
  name: string;
  displayName: string;
  supportsCli: boolean;
  supportsApi: boolean;
  defaultModel: string;
  cliCommand?: string;
}

const providers: ProviderDefinition[] = [
  {
    name: "claude",
    displayName: "Claude (Anthropic)",
    supportsCli: true,
    supportsApi: true,
    defaultModel: "claude-sonnet-4-20250514",
    cliCommand: "claude",
  },
  {
    name: "openai",
    displayName: "OpenAI (GPT-4o)",
    supportsCli: false,
    supportsApi: true,
    defaultModel: "gpt-4o",
  },
  {
    name: "gemini",
    displayName: "Gemini (Google)",
    supportsCli: false,
    supportsApi: true,
    defaultModel: "gemini-2.5-flash",
  },
];

export function getAvailableProviders(): ProviderDefinition[] {
  return [...providers];
}

export function getProviderDefinition(name: string): ProviderDefinition | undefined {
  return providers.find((p) => p.name === name);
}

export function createProvider(config: ProviderConfig): LLMProvider {
  const def = getProviderDefinition(config.provider);
  if (!def) {
    throw new Error(`Unknown AI provider: "${config.provider}". Available: ${providers.map((p) => p.name).join(", ")}`);
  }

  if (config.method === "cli") {
    if (config.provider === "claude") {
      return createClaudeCliProvider(config.cliCommand ?? "claude");
    }
    throw new Error(`Provider "${config.provider}" does not support CLI mode`);
  }

  // API mode
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new Error(`API key is required for "${config.provider}" API mode`);
  }

  const model = config.model ?? def.defaultModel;

  switch (config.provider) {
    case "claude":
      return createClaudeApiProvider(apiKey, model);
    case "openai":
      return createOpenaiApiProvider(apiKey, model);
    case "gemini":
      return createGeminiApiProvider(apiKey, model);
    default:
      throw new Error(`Unknown provider: "${config.provider}"`);
  }
}
