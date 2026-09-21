import fs from "node:fs";
import path from "node:path";
import type { HarnessConfig } from "../core/harness-schema.js";
import type { BuildingBlock } from "../catalog/types.js";
import type { ProjectFacts } from "../detector/types.js";
import { buildPresetHarness, defaultParamsFor, type PresetName } from "../core/presets.js";

// Jev (TypeSafe's System One model) as the catalog chooser (#129). It never
// generates text: we send the description plus detector facts as `state` and
// ask one yes/no ("noul") question per selectable block plus one "choice" for
// the overall strictness, in a single fan-out call. Answers are calibrated
// probabilities, so a confidence band decides on / off / leave-as-preset.
// Rule text and free-form params come from presets and the detector, never
// from the model. Jev is early access, so this is always optional: no key,
// no call.

export const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const TYPESAFE_MODEL = "jev-latest";

/** Blocks a project may or may not want. Always-on and loop-internal blocks are never asked. */
export const SELECTABLE_BLOCKS = [
  "branch-guard", "commit-test-gate", "commit-typecheck-gate", "command-guard", "path-guard",
  "lockfile-guard", "secret-file-guard", "tdd-guard", "sql-guard",
  "lint-on-save", "format-on-save", "test-on-save", "auto-pr", "desktop-notify", "compact-context",
  "stop-test-gate", "stop-uncommitted-warn",
] as const;

export type Decision = "on" | "off" | "undecided";

export interface ChooserInput {
  description: string;
  facts?: ProjectFacts;
  blocks: Pick<BuildingBlock, "id" | "description">[];
}

export interface JevRequest {
  model: string;
  state: Record<string, unknown>;
  questions: Record<string, Record<string, unknown>>;
}

export interface ChooserResult {
  strictness: PresetName;
  blocks: Map<string, Decision>;
  /** raw probabilities, for `omh init` to print */
  probabilities?: Record<string, number>;
  usage?: { input_tokens: number; output_tokens: number };
}

type NoulAnswer = { type: "noul"; noul: number };
type ChoiceAnswer = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
type Answer = NoulAnswer | ChoiceAnswer | { type: string; [k: string]: unknown };

export const THRESHOLDS = { on: 0.65, off: 0.35, choiceConfidence: 0.5 };

export function buildJevRequest(input: ChooserInput): JevRequest {
  const byId = new Map(input.blocks.map((b) => [b.id, b]));
  const questions: JevRequest["questions"] = {};
  for (const id of SELECTABLE_BLOCKS) {
    const b = byId.get(id);
    if (!b) continue;
    questions[`block:${id}`] = {
      type: "noul",
      instructions:
        `Should the '${id}' guardrail be enabled for this project? It ${lowerFirst(b.description)}. ` +
        "Enable it only if the user's description or the detected project facts call for it, " +
        "or it is a sensible default that would not get in the user's way. " +
        "If the user explicitly rejects it, the answer is no.",
    };
  }
  questions.strictness = {
    type: "choice",
    instructions: "How strict should the generated guardrails be overall, given the user's description?",
    criteria: {
      minimal: "only catastrophic actions are blocked (dangerous shell commands, direct commits to main, writes into build output)",
      safe: "tests and typecheck must pass before commits, lockfiles and secret files are protected, lint runs on save; the workflow stays smooth",
      strict: "test-first (TDD) is enforced on every source edit in addition to every quality gate",
    },
  };
  const state: Record<string, unknown> = { user_description: input.description };
  if (input.facts) state.detected_project_facts = compactFacts(input.facts);
  return { model: TYPESAFE_MODEL, state, questions };
}

export function routeAnswers(answers: Record<string, Answer>): Pick<ChooserResult, "strictness" | "blocks" | "probabilities"> {
  const blocks = new Map<string, Decision>();
  const probabilities: Record<string, number> = {};
  for (const [key, a] of Object.entries(answers)) {
    if (!key.startsWith("block:") || a.type !== "noul") continue;
    const p = (a as NoulAnswer).noul;
    const id = key.slice("block:".length);
    // Only ids we asked about, only well-formed probabilities: the response is
    // external input and must not be able to enable an arbitrary block.
    if (!(SELECTABLE_BLOCKS as readonly string[]).includes(id)) continue;
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) continue;
    probabilities[id] = p;
    blocks.set(id, p >= THRESHOLDS.on ? "on" : p <= THRESHOLDS.off ? "off" : "undecided");
  }
  let strictness: PresetName = "safe";
  const s = answers.strictness as ChoiceAnswer | undefined;
  if (s && s.type === "choice" && s.confidence >= THRESHOLDS.choiceConfidence && ["minimal", "safe", "strict"].includes(s.choice)) {
    strictness = s.choice as PresetName;
  }
  return { strictness, blocks, probabilities };
}

export async function chooseWithJev(
  input: ChooserInput,
  opts: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<ChooserResult> {
  const request = buildJevRequest(input);
  const f = opts.fetchImpl ?? fetch;
  const res = await f(TYPESAFE_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`TypeSafe API error ${res.status}: ${body || res.statusText}`);
  }
  const json = (await res.json()) as { answers?: Record<string, Answer>; usage?: ChooserResult["usage"] };
  return { ...routeAnswers(json.answers ?? {}), usage: json.usage };
}

export interface AppliedHarness extends HarnessConfig {
  skipped: { block: string; reason: string }[];
}

/** Start from the preset named by the strictness choice (or `base`) and apply the per-block decisions. */
export function applyChoices(
  base: HarnessConfig,
  result: Pick<ChooserResult, "strictness" | "blocks">,
  facts?: ProjectFacts,
): AppliedHarness {
  const hooks = base.hooks.map((h) => ({ ...h, params: { ...h.params } }));
  const skipped: AppliedHarness["skipped"] = [];
  for (const [id, decision] of result.blocks) {
    const idx = hooks.findIndex((h) => h.block === id);
    if (decision === "off") {
      if (idx >= 0) hooks.splice(idx, 1);
    } else if (decision === "on" && idx < 0) {
      const params = defaultParamsFor(id, facts);
      if (params === null) {
        skipped.push({ block: id, reason: `${id} needs a param the project detector could not supply (${requiredParamHint(id)})` });
        continue;
      }
      hooks.push({ block: id, params, mode: "block" });
    }
  }
  return { ...base, hooks, skipped };
}

/** Preset to start from, then the chooser's decisions on top. */
export function harnessFromChoices(
  result: Pick<ChooserResult, "strictness" | "blocks">,
  facts: ProjectFacts | undefined,
  meta: { description?: string },
  tools: { jgrep?: boolean } = {},
): AppliedHarness {
  const base = buildPresetHarness(result.strictness, facts, meta, tools);
  return applyChoices(base, result, facts);
}

/** TYPESAFE_API_KEY from the environment, else from a .env file in the project directory. */
export function resolveTypesafeApiKey(projectDir: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.TYPESAFE_API_KEY?.trim()) return env.TYPESAFE_API_KEY.trim();
  try {
    const text = fs.readFileSync(path.join(projectDir, ".env"), "utf-8");
    const m = text.match(/^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=\s*["']?([^"'\r\n#]+)["']?/m);
    return m?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function requiredParamHint(id: string): string {
  return { "commit-test-gate": "testCommand", "commit-typecheck-gate": "typecheckCommand", "lint-on-save": "command",
    "test-on-save": "testCommand", "format-on-save": "command", "path-guard": "blockedPaths" }[id] ?? "params";
}

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

// Only the facts that inform a selection; large irrelevant state degrades Jev.
function compactFacts(f: ProjectFacts): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ["languages", "frameworks", "packageManagers", "testCommands", "lintCommands", "typecheckCommands", "buildCommands", "blockedPaths"] as const) {
    if (f[k]?.length) out[k] = f[k];
  }
  return out;
}
