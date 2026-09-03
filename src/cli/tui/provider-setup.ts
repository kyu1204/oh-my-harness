import * as p from "@clack/prompts";
import {
  getAvailableProviders,
  getProviderDefinition,
  type ProviderDefinition,
} from "../../nl/provider-registry.js";
import { listModels, type ListModelsOptions } from "../../nl/list-models.js";
import { ensureCodexOauthApiAuth } from "../../nl/providers/codex-oauth-api.js";
import { createPkce, buildOpenrouterAuthUrl, exchangeOpenrouterCode } from "../../nl/providers/openrouter-oauth.js";
import { openInBrowser, hyperlink } from "./open-browser.js";

/**
 * Show a sign-in URL and try to open it. The URL is printed as a bare line
 * outside any box: clack's note hard-wraps and adds borders, which breaks
 * terminal link detection on narrow screens.
 */
async function showAuthLink(title: string, url: string, extra?: string): Promise<void> {
  const opened = await openInBrowser(url);
  p.log.step(title);
  p.log.message(opened ? "Opened in your browser. If it did not open, visit:" : "Open this URL in your browser:");
  process.stdout.write(`\n${hyperlink(url)}\n\n`);
  if (extra) p.log.message(extra);
}
import {
  saveProviderConfig,
  type ProviderConfig,
} from "../../nl/config-store.js";

const CUSTOM_MODEL = "__custom__";

function cancelled(): undefined {
  p.cancel("Provider setup cancelled.");
  return undefined;
}

/**
 * Model picker: live list from the provider when reachable, static fallback
 * otherwise, and always an "enter model id" escape hatch so a brand-new model
 * never needs a release of this tool.
 */
async function pickModel(def: ProviderDefinition, creds: ListModelsOptions): Promise<string | undefined> {
  let ids: string[] = [];
  const s = p.spinner();
  s.start("Fetching available models...");
  try {
    ids = await listModels(def.name, creds);
    s.stop(`Found ${ids.length} models`);
  } catch (err) {
    s.stop(`Could not fetch models (${(err as Error).message}); using built-in list`);
  }

  const staticIds = def.availableModels.map((m) => m.id);
  const labels = new Map(def.availableModels.map((m) => [m.id, m.label]));
  const merged = ids.length > 0 ? ids : staticIds;

  const options = merged.map((id) => ({
    value: id,
    label: labels.get(id) ?? id,
    hint: id === def.defaultModel ? "default" : undefined,
  }));
  options.push({ value: CUSTOM_MODEL, label: "Other (enter model id)", hint: undefined });

  let model: string | symbol = CUSTOM_MODEL;
  if (options.length > 1) {
    const initialValue = merged.includes(def.defaultModel) ? def.defaultModel : merged[0];
    // Long lists (OpenRouter has hundreds) are unusable as a plain select.
    model = options.length > 20
      ? await p.autocomplete({ message: "Select model (type to filter):", options, initialValue })
      : await p.select({ message: "Select model:", options, initialValue });
    if (p.isCancel(model)) return cancelled();
  }

  if (model === CUSTOM_MODEL) {
    const typed = await p.text({
      message: "Model id:",
      placeholder: def.defaultModel || "e.g. llama3.2",
      validate: (v) => (v?.trim() ? undefined : "Model id is required"),
    });
    if (p.isCancel(typed)) return cancelled();
    return (typed as string).trim();
  }
  return model as string;
}

export async function runProviderSetup(): Promise<ProviderConfig | undefined> {
  p.intro("AI Provider Setup");

  const providers = getAvailableProviders();

  // Step 1: provider
  const providerName = await p.select({
    message: "Select AI provider for natural language mode:",
    options: providers.map((prov) => ({ value: prov.name, label: prov.displayName })),
  });
  if (p.isCancel(providerName)) return cancelled();

  const def = getProviderDefinition(providerName as string)!;

  // Step 2: method (only asked when there is a real choice)
  const methodOptions = [
    def.supportsCli ? { value: "cli", label: `Use the ${def.cliCommand ?? def.name} CLI`, hint: "no API key needed" } : undefined,
    def.supportsApi ? { value: "api", label: "API key" } : undefined,
    def.supportsOAuth ? { value: "oauth", label: `Via the ${def.cliCommand ?? def.name} CLI`, hint: `runs ${def.cliCommand ?? def.name} exec` } : undefined,
    def.supportsOAuthApi ? { value: "oauth-api", label: "Direct API (no CLI needed)", hint: "device-code sign-in, token stored in ~/.omh" } : undefined,
  ].filter((o): o is { value: ProviderConfig["method"]; label: string; hint?: string } => o !== undefined);

  let method: ProviderConfig["method"];
  if (methodOptions.length > 1) {
    const selected = await p.select({ message: "How would you like to connect?", options: methodOptions });
    if (p.isCancel(selected)) return cancelled();
    method = selected as ProviderConfig["method"];
  } else if (methodOptions[0]) {
    method = methodOptions[0].value;
  } else {
    throw new Error(`Provider "${def.name}" has no supported authentication method`);
  }

  const config: ProviderConfig = { provider: providerName as ProviderConfig["provider"], method };

  // Step 3: credentials + model
  if (method === "api") {
    if (def.requiresBaseUrl) {
      const baseUrl = await p.text({
        message: "Base URL of the OpenAI-compatible endpoint:",
        placeholder: def.defaultBaseUrl,
        defaultValue: def.defaultBaseUrl,
        validate: (v) => (/^https?:\/\//.test((v ?? def.defaultBaseUrl ?? "").trim()) ? undefined : "Must start with http:// or https://"),
      });
      if (p.isCancel(baseUrl)) return cancelled();
      config.baseUrl = ((baseUrl as string) || def.defaultBaseUrl || "").trim().replace(/\/+$/, "");
    }

    let keySource: "paste" | "browser" = "paste";
    if (def.supportsBrowserKeyLogin) {
      const picked = await p.select({
        message: "How do you want to provide the API key?",
        options: [
          { value: "browser", label: "Sign in with browser", hint: "creates a key on your account" },
          { value: "paste", label: "Paste an existing API key" },
        ],
      });
      if (p.isCancel(picked)) return cancelled();
      keySource = picked as "paste" | "browser";
    }

    if (keySource === "browser") {
      const { verifier, challenge } = createPkce();
      await showAuthLink(`${def.displayName} sign-in`, buildOpenrouterAuthUrl(challenge), "Approve, then paste the code shown on that page below.");
      const code = await p.password({
        message: "Authorization code:",
        validate: (v) => (v?.trim() ? undefined : "Code is required"),
      });
      if (p.isCancel(code)) return cancelled();
      const s = p.spinner();
      s.start("Exchanging code for API key...");
      try {
        config.apiKey = await exchangeOpenrouterCode(code as string, verifier);
        s.stop("API key created");
      } catch (err) {
        s.stop(`Sign-in failed: ${(err as Error).message}`);
        return cancelled();
      }
    } else {
      const apiKey = await p.password({
        message: def.requiresBaseUrl ? "API key (leave empty if the server needs none):" : `Enter your ${def.displayName} API key:`,
        validate: (v) => (!def.requiresBaseUrl && !v?.trim() ? "API key is required" : undefined),
      });
      if (p.isCancel(apiKey)) return cancelled();
      if ((apiKey as string)?.trim()) config.apiKey = (apiKey as string).trim();
    }

    const model = await pickModel(def, { apiKey: config.apiKey, baseUrl: config.baseUrl });
    if (!model) return undefined;
    config.model = model;
  } else if (method === "oauth" || method === "oauth-api") {
    let codexAuth: ListModelsOptions["codexAuth"];
    if (method === "oauth") {
      config.cliCommand = def.cliCommand ?? def.name;
    } else {
      // Sign in first so the model list can come from the live Codex registry.
      codexAuth = await ensureCodexOauthApiAuth({
        onDeviceCode: ({ url, code }) => {
          void showAuthLink("Codex sign-in", url, `Enter this code:  ${code}`);
        },
      });
      p.log.success("Codex session saved under ~/.omh.");
    }

    const model = await pickModel(def, { codexAuth });
    if (!model) return undefined;
    config.model = model;
  } else {
    config.cliCommand = def.cliCommand ?? def.name;
  }

  await saveProviderConfig(config);
  p.log.success(`Provider saved: ${def.displayName} (${method})`);
  return config;
}
