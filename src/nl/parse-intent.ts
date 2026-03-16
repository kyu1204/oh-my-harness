import { spawn } from "node:child_process";
import yaml from "js-yaml";
import { buildPresetSelectionPrompt, buildHarnessGenerationPrompt } from "./prompt-templates.js";
import type { PresetInfo } from "./prompt-templates.js";
import { HarnessConfigSchema } from "../core/harness-schema.js";
import type { HarnessConfig } from "../core/harness-schema.js";

export interface ParsedIntent {
  presets: string[];
  confidence: number;
  explanation: string;
}

export type ClaudeRunner = (prompt: string) => Promise<string>;

export const defaultClaudeRunner: ClaudeRunner = async (prompt) => {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", ["-p", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new Error("claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code"));
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`claude exited with code ${code}: ${stderr || stdout}`));
      }
    });

    // Write prompt to stdin and close
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
};

function extractJson(text: string): string {
  // Try to extract a JSON object from text that may contain extra content
  const match = text.match(/\{[\s\S]*\}/);
  if (match) return match[0];
  return text.trim();
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

export async function generateHarnessConfig(
  description: string,
  runner: ClaudeRunner = defaultClaudeRunner,
): Promise<HarnessConfig> {
  const prompt = buildHarnessGenerationPrompt(description);

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
