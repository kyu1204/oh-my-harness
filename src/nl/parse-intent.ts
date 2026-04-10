import yaml from "js-yaml";
import { buildPresetSelectionPrompt, buildHarnessGenerationPrompt } from "./prompt-templates.js";
import type { PresetInfo, CatalogBlockInfo } from "./prompt-templates.js";
import { HarnessConfigSchema } from "../core/harness-schema.js";
import type { HarnessConfig } from "../core/harness-schema.js";
import type { ProjectFacts } from "../detector/project-detector.js";
import { loadProviderConfig } from "./config-store.js";
import { createProvider } from "./provider-registry.js";
import { createClaudeCliProvider } from "./providers/claude-cli.js";

export interface ParsedIntent {
  presets: string[];
  confidence: number;
  explanation: string;
}

/** Generic LLM runner type — takes a prompt and returns a response string */
export type LLMRunner = (prompt: string) => Promise<string>;

/** @deprecated Use LLMRunner instead. Kept for backward compatibility. */
export type ClaudeRunner = LLMRunner;

/** Creates a runner from the saved provider config (~/.omh/config.json) or falls back to claude CLI */
export async function createDefaultRunner(): Promise<LLMRunner> {
  const config = await loadProviderConfig();
  if (config) {
    const provider = createProvider(config);
    return (prompt: string) => provider.run(prompt);
  }
  // Fallback: claude CLI
  const cliProvider = createClaudeCliProvider("claude");
  return (prompt: string) => cliProvider.run(prompt);
}

/** Legacy default runner using claude CLI directly */
export const defaultClaudeRunner: LLMRunner = async (prompt) => {
  const cliProvider = createClaudeCliProvider("claude");
  return cliProvider.run(prompt);
};

function extractJson(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) return text.trim();

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return text.slice(start).trim();
}

function validateParsedIntent(obj: unknown): ParsedIntent {
  if (typeof obj !== "object" || obj === null) {
    throw new Error("Expected a JSON object from claude output");
  }
  const record = obj as Record<string, unknown>;
  if (!Array.isArray(record["presets"])) {
    throw new Error('Parsed JSON is missing required field "presets" (array)');
  }
  if (!record["presets"].every((p: unknown) => typeof p === "string")) {
    throw new Error('All elements in "presets" must be strings');
  }
  if (typeof record["confidence"] !== "number") {
    throw new Error('Parsed JSON is missing required field "confidence" (number)');
  }
  if (typeof record["explanation"] !== "string") {
    throw new Error('Parsed JSON is missing required field "explanation" (string)');
  }
  return {
    presets: record["presets"] as string[],
    confidence: record["confidence"],
    explanation: record["explanation"],
  };
}

export async function parseNaturalLanguage(
  description: string,
  availablePresets: PresetInfo[],
  runner: ClaudeRunner = defaultClaudeRunner,
): Promise<ParsedIntent> {
  const prompt = buildPresetSelectionPrompt(description, availablePresets);

  let stdout: string;
  try {
    stdout = await runner(prompt);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT" || /not found|unavailable/i.test(error.message ?? "")) {
      throw new Error(
        `claude CLI not found or unavailable. Install it with: npm install -g @anthropic-ai/claude-code`,
      );
    }
    throw err;
  }

  const jsonStr = extractJson(stdout);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse JSON from claude output. Raw output: ${stdout}`);
  }

  return validateParsedIntent(parsed);
}

function extractYaml(text: string): string {
  // Try to extract YAML from markdown code block
  const codeBlockMatch = text.match(/```(?:ya?ml)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  return text.trim();
}

function findInvalidBlockIds(
  config: HarnessConfig,
  catalogBlocks: CatalogBlockInfo[],
): string[] {
  const validIds = new Set(catalogBlocks.map((b) => b.id));
  return (config.hooks ?? [])
    .map((h) => h.block)
    .filter((id) => !validIds.has(id));
}

function buildCorrectionPrompt(
  originalPrompt: string,
  invalidIds: string[],
  catalogBlocks: CatalogBlockInfo[],
): string {
  const validList = catalogBlocks.map((b) => b.id).join(", ");
  return `${originalPrompt}

CORRECTION NEEDED: The previous output contained invalid block ids that do not exist in the catalog: ${invalidIds.join(", ")}

Valid block ids are ONLY: ${validList}

Remove or replace the invalid blocks with valid ones from the list above. Return ONLY valid YAML.`;
}

async function runAndParse(
  runner: ClaudeRunner,
  prompt: string,
): Promise<HarnessConfig> {
  let stdout: string;
  try {
    stdout = await runner(prompt);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT" || /not found|unavailable/i.test(error.message ?? "")) {
      throw new Error(
        `claude CLI not found or unavailable. Install it with: npm install -g @anthropic-ai/claude-code`,
      );
    }
    throw err;
  }

  const yamlStr = extractYaml(stdout);
  let parsed: unknown;
  try {
    parsed = yaml.load(yamlStr);
  } catch {
    throw new Error(`Failed to parse YAML from claude output. Raw output: ${stdout}`);
  }

  const result = HarnessConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Generated config failed schema validation: ${result.error.message}. Raw output: ${stdout}`,
    );
  }

  return result.data;
}

export async function generateHarnessConfig(
  description: string,
  runner: ClaudeRunner = defaultClaudeRunner,
  catalogBlocks?: CatalogBlockInfo[],
  projectFacts?: ProjectFacts,
): Promise<HarnessConfig> {
  const prompt = buildHarnessGenerationPrompt(description, catalogBlocks, projectFacts);
  const config = await runAndParse(runner, prompt);

  // Validate block ids if catalog is provided
  if (catalogBlocks && catalogBlocks.length > 0) {
    const invalidIds = findInvalidBlockIds(config, catalogBlocks);
    if (invalidIds.length > 0) {
      // Feedback loop: retry with correction prompt (max 1 retry)
      const correctionPrompt = buildCorrectionPrompt(prompt, invalidIds, catalogBlocks);
      const retryConfig = await runAndParse(runner, correctionPrompt);

      // Strip any remaining invalid blocks after retry
      const stillInvalid = findInvalidBlockIds(retryConfig, catalogBlocks);
      if (stillInvalid.length > 0) {
        const validIds = new Set(catalogBlocks.map((b) => b.id));
        retryConfig.hooks = (retryConfig.hooks ?? []).filter((h) => validIds.has(h.block));
      }
      return retryConfig;
    }
  }

  return config;
}
