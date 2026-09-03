import type { ProviderConfig } from "./config-store.js";
import { createClaudeCliProvider } from "./providers/claude-cli.js";
import { createClaudeApiProvider } from "./providers/claude-api.js";
import { createOpenaiApiProvider, OPENAI_BASE_URL } from "./providers/openai-api.js";
import { createGeminiApiProvider } from "./providers/gemini-api.js";
import { createCodexOauthProvider } from "./providers/codex-oauth.js";
import { createCodexOauthApiProvider } from "./providers/codex-oauth-api.js";
import { OPENROUTER_BASE_URL } from "./providers/openrouter-oauth.js";

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
  supportsOAuth: boolean;
  supportsOAuthApi: boolean;
  /** Static fallback list; the TUI fetches the live list first when the provider has one. */
  defaultModel: string;
  availableModels: ModelEntry[];
  cliCommand?: string;
  /** User must supply an OpenAI-compatible base URL (local servers, routers). */
  requiresBaseUrl?: boolean;
  defaultBaseUrl?: string;
  /** Setup can obtain the API key through a browser sign-in instead of pasting one. */
  supportsBrowserKeyLogin?: boolean;
}

const providers: ProviderDefinition[] = [
  {
    name: "claude",
    displayName: "Claude (Anthropic)",
    supportsCli: true,
    supportsApi: true,
    supportsOAuth: false,
    supportsOAuthApi: false,
    defaultModel: "claude-sonnet-5",
    availableModels: [
      { id: "claude-opus-5", label: "Claude Opus 5 — most capable, 1M context" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5 — balanced, 1M context" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest, 200k context" },
    ],
    cliCommand: "claude",
  },
  {
    name: "openai",
    displayName: "OpenAI (GPT-5.5)",
    supportsCli: false,
    supportsApi: true,
    supportsOAuth: false,
    supportsOAuthApi: false,
    defaultModel: "gpt-5.5",
    availableModels: [
      { id: "gpt-5.5", label: "GPT-5.5 — newest frontier, complex reasoning & coding" },
      { id: "gpt-5.4", label: "GPT-5.4 — previous flagship, agentic & coding" },
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
    supportsOAuth: false,
    supportsOAuthApi: false,
    defaultModel: "gemini-2.5-pro",
    availableModels: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro — most advanced stable" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash — fastest stable" },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite — most cost-effective" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview — cutting-edge (preview)" },
      { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview — frontier performance (preview)" },
    ],
  },
  {
    name: "codex",
    displayName: "Codex (ChatGPT subscription login)",
    supportsCli: false,
    supportsApi: false,
    supportsOAuth: true,
    supportsOAuthApi: true,
    defaultModel: "gpt-5.5",
    availableModels: [
      { id: "gpt-5.5", label: "GPT-5.5 — frontier Codex reasoning" },
      { id: "gpt-5.4", label: "GPT-5.4 — previous flagship" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini — faster runs" },
    ],
    cliCommand: "codex",
  },
  {
    name: "openrouter",
    displayName: "OpenRouter (300+ models, one key, free tier available)",
    supportsCli: false,
    supportsApi: true,
    supportsOAuth: false,
    supportsOAuthApi: false,
    supportsBrowserKeyLogin: true,
    defaultModel: "openrouter/auto",
    availableModels: [
      { id: "openrouter/auto", label: "Auto — OpenRouter picks a model per request" },
      { id: "openrouter/free", label: "Free router — rotates across free models" },
    ],
  },
  {
    name: "openai-compatible",
    displayName: "OpenAI-compatible endpoint (Ollama, llama.cpp, MLX, LM Studio, routers)",
    supportsCli: false,
    supportsApi: true,
    supportsOAuth: false,
    supportsOAuthApi: false,
    defaultModel: "",
    availableModels: [],
    requiresBaseUrl: true,
    defaultBaseUrl: "http://localhost:11434/v1",
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

  if (config.method !== "cli" && config.method !== "api" && config.method !== "oauth" && config.method !== "oauth-api") {
    throw new Error(`Unsupported provider method: "${String(config.method)}"`);
  }

  if (config.method === "cli" && !def.supportsCli) {
    throw new Error(`Provider "${config.provider}" does not support CLI mode`);
  }

  if (config.method === "api" && !def.supportsApi) {
    throw new Error(`Provider "${config.provider}" does not support API mode`);
  }

  if (config.method === "oauth" && !def.supportsOAuth) {
    throw new Error(`Provider "${config.provider}" does not support OAuth mode`);
  }

  if (config.method === "oauth-api" && !def.supportsOAuthApi) {
    throw new Error(`Provider "${config.provider}" does not support OAuth API mode`);
  }

  if (config.method === "cli") {
    if (config.provider === "claude") {
      return createClaudeCliProvider(config.cliCommand ?? "claude");
    }
    throw new Error(`Provider "${config.provider}" does not support CLI mode`);
  }

  if (config.method === "oauth") {
    if (config.provider === "codex") {
      const model = config.model?.trim() || def.defaultModel;
      return createCodexOauthProvider(config.cliCommand ?? "codex", model);
    }
    throw new Error(`Provider "${config.provider}" does not support OAuth mode`);
  }

  if (config.method === "oauth-api") {
    const model = config.model?.trim() || def.defaultModel;
    return createCodexOauthApiProvider({ model });
  }

  // API mode
  const apiKey = config.apiKey?.trim() ?? "";
  const model = config.model?.trim() || def.defaultModel;

  if (config.provider === "openai-compatible") {
    const baseUrl = config.baseUrl?.trim();
    if (!baseUrl) throw new Error(`baseUrl is required for "openai-compatible" provider`);
    if (!model) throw new Error(`model is required for "openai-compatible" provider`);
    return createOpenaiApiProvider(apiKey, model, { baseUrl, name: "openai-compatible" });
  }

  if (!apiKey) {
    throw new Error(`API key is required for "${config.provider}" API mode`);
  }

  switch (config.provider) {
    case "claude":
      return createClaudeApiProvider(apiKey, model);
    case "openai":
      return createOpenaiApiProvider(apiKey, model, { baseUrl: OPENAI_BASE_URL });
    case "openrouter":
      return createOpenaiApiProvider(apiKey, model, {
        baseUrl: OPENROUTER_BASE_URL,
        name: "openrouter",
        headers: { "HTTP-Referer": "https://github.com/kyu1204/oh-my-harness", "X-Title": "oh-my-harness" },
      });
    case "gemini":
      return createGeminiApiProvider(apiKey, model);
    default:
      throw new Error(`Unknown provider: "${config.provider}"`);
  }
}
