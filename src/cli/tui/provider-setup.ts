import * as p from "@clack/prompts";
import {
  getAvailableProviders,
  getProviderDefinition,
} from "../../nl/provider-registry.js";
import {
  saveProviderConfig,
  type ProviderConfig,
} from "../../nl/config-store.js";

export async function runProviderSetup(): Promise<ProviderConfig | undefined> {
  p.intro("AI Provider Setup");

  const providers = getAvailableProviders();

  // Step 1: Select provider
  const providerName = await p.select({
    message: "Select AI provider for natural language mode:",
    options: providers.map((prov) => ({
      value: prov.name,
      label: prov.displayName,
    })),
  });

  if (p.isCancel(providerName)) {
    p.cancel("Provider setup cancelled.");
    return undefined;
  }

  const def = getProviderDefinition(providerName as string)!;

  // Step 2: Select method (CLI or API)
  let method: "cli" | "api";

  if (def.supportsCli && def.supportsApi) {
    const selected = await p.select({
      message: "How would you like to connect?",
      options: [
        { value: "cli", label: `CLI tool (${def.cliCommand ?? def.name})` },
        { value: "api", label: "API Key" },
      ],
    });

    if (p.isCancel(selected)) {
      p.cancel("Provider setup cancelled.");
      return undefined;
    }
    method = selected as "cli" | "api";
  } else if (def.supportsCli) {
    method = "cli";
  } else {
    method = "api";
  }

  const config: ProviderConfig = {
    provider: providerName as ProviderConfig["provider"],
    method,
  };

  // Step 3: Get API key if needed
  if (method === "api") {
    const apiKey = await p.text({
      message: `Enter your ${def.displayName} API key:`,
      placeholder: "sk-...",
      validate: (value) => {
        if (!value || !value.trim()) return "API key is required";
        return undefined;
      },
    });

    if (p.isCancel(apiKey)) {
      p.cancel("Provider setup cancelled.");
      return undefined;
    }

    config.apiKey = apiKey as string;

    // Select model from available list
    const selectedModel = await p.select({
      message: "Select model:",
      options: def.availableModels.map((m) => ({
        value: m.id,
        label: m.label,
        hint: m.id === def.defaultModel ? "default" : undefined,
      })),
      initialValue: def.defaultModel,
    });

    if (p.isCancel(selectedModel)) {
      p.cancel("Provider setup cancelled.");
      return undefined;
    }

    config.model = selectedModel as string;
  } else {
    config.cliCommand = def.cliCommand ?? def.name;
  }

  // Save config
  await saveProviderConfig(config);
  p.log.success(`Provider saved: ${def.displayName} (${method})`);

  return config;
}
