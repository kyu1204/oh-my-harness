import type { ProviderConfig } from "./config-store.js";
import { createClaudeCliProvider } from "./providers/claude-cli.js";
import { createClaudeApiProvider } from "./providers/claude-api.js";
import { createOpenaiApiProvider } from "./providers/openai-api.js";
import { createGeminiApiProvider } from "./providers/gemini-api.js";

export interface LLMProvider {
  name: string;
  run(prompt: string): Promise<string>;
}

export interface ModelEntry {
  id: string;
  label: string;
}

export interface ProviderDefinition {
  name: string;
  displayName: string;
  supportsCli: boolean;
  supportsApi: boolean;
  defaultModel: string;
  availableModels: ModelEntry[];
  cliCommand?: string;
}

const providers: ProviderDefinition[] = [
  {
    name: "claude",
    displayName: "Claude (Anthropic)",
    supportsCli: true,
    supportsApi: true,
    defaultModel: "claude-sonnet-4-6",
    availableModels: [
      { id: "claude-opus-4-6", label: "Claude Opus 4.6 — most capable, 1M context" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 — balanced, 1M context" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest, 200k context" },
    ],
    cliCommand: "claude",
  },
  {
    name: "openai",
    displayName: "OpenAI (GPT-5.4)",
    supportsCli: false,
    supportsApi: true,
    defaultModel: "gpt-5.4",
    availableModels: [
      { id: "gpt-5.4", label: "GPT-5.4 — flagship, agentic & coding" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini — strongest mini model" },
      { id: "gpt-5.4-nano", label: "GPT-5.4 Nano — cheapest GPT-5.4 class" },
      { id: "gpt-4.1", label: "GPT-4.1 — best non-reasoning, coding" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 Mini — balanced speed/cost" },
      { id: "o3", label: "o3 — complex reasoning, math, science" },
      { id: "o4-mini", label: "o4-mini — fast reasoning" },
    ],
  },
  {
    name: "gemini",
    displayName: "Gemini (Google)",
    supportsCli: false,
    supportsApi: true,
    defaultModel: "gemini-2.5-pro",
    availableModels: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro — most advanced stable" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash — fastest stable" },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite — most cost-effective" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview — cutting-edge (preview)" },
      { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview — frontier performance (preview)" },
    ],
  },
];

export function getAvailableProviders(): ProviderDefinition[] {
  return [...providers];
}

export function getProviderDefinition(name: string): ProviderDefinition | undefined {
  return providers.find((p) => p.name === name);
}

export function getAvailableModels(providerName: string): ModelEntry[] {
  const def = providers.find((p) => p.name === providerName);
  return def ? [...def.availableModels] : [];
}

export function createProvider(config: ProviderConfig): LLMProvider {
  const def = getProviderDefinition(config.provider);
  if (!def) {
    throw new Error(`Unknown AI provider: "${config.provider}". Available: ${providers.map((p) => p.name).join(", ")}`);
  }

  if (config.method !== "cli" && config.method !== "api") {
    throw new Error(`Unsupported provider method: "${String(config.method)}"`);
  }

  if (config.method === "cli") {
    if (config.provider === "claude") {
      return createClaudeCliProvider(config.cliCommand ?? "claude");
    }
    throw new Error(`Provider "${config.provider}" does not support CLI mode`);
  }

  // API mode
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new Error(`API key is required for "${config.provider}" API mode`);
  }

  const model = config.model?.trim() || def.defaultModel;

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
