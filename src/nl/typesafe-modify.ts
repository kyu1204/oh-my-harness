import type { HarnessConfig } from "../core/harness-schema.js";
import type { BuildingBlock } from "../catalog/types.js";
import type { ProjectFacts } from "../detector/types.js";
import { defaultParamsFor } from "../core/presets.js";
import { SELECTABLE_BLOCKS, TYPESAFE_ENDPOINT, TYPESAFE_MODEL, THRESHOLDS } from "./typesafe-chooser.js";

// `omh modify "request"` (#118) through Jev: one choice question per
// selectable block ("what does the request ask for this block?"), answers
// routed by confidence, applied as structured edits to harness.yaml. No
// text is generated; params come from the detector or catalog defaults.

export const MODIFY_ACTIONS = ["enable", "disable", "ask", "keep"] as const;
export type ModifyAction = (typeof MODIFY_ACTIONS)[number];

export interface ModifyInput {
  request: string;
  harness: HarnessConfig;
  blocks: Pick<BuildingBlock, "id" | "description">[];
}

export interface ModifyRequest {
  model: string;
  state: Record<string, unknown>;
  questions: Record<string, Record<string, unknown>>;
}

type ChoiceAnswer = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };

export function buildModifyRequest(input: ModifyInput): ModifyRequest {
  const byId = new Map(input.blocks.map((b) => [b.id, b]));
  const enabled = new Set(input.harness.hooks.map((h) => h.block));
  const questions: ModifyRequest["questions"] = {};
  for (const id of SELECTABLE_BLOCKS) {
    const b = byId.get(id);
    if (!b) continue;
    const state = enabled.has(id) ? "currently ENABLED" : "currently DISABLED";
    questions[`block:${id}`] = {
      type: "choice",
      instructions:
        `The user wants to change their guardrail configuration. Block '${id}' (${state}) ${lowerFirst(b.description)}. ` +
        "What does the user's request ask for this block? Answer keep unless the request clearly refers to it.",
      criteria: {
        enable: "turn this block on (add it, or restore it to blocking mode)",
        disable: "turn this block off entirely",
        ask: "keep it but make it ask for confirmation instead of blocking",
        keep: "the request does not concern this block",
      },
    };
  }
  return {
    model: TYPESAFE_MODEL,
    state: {
      request: input.request,
      currently_enabled: [...enabled],
      ask_mode: input.harness.hooks.filter((h) => h.mode === "ask").map((h) => h.block),
    },
    questions,
  };
}

export function routeModifyAnswers(answers: Record<string, ChoiceAnswer | { type: string }>): Map<string, ModifyAction> {
  const out = new Map<string, ModifyAction>();
  for (const [key, a] of Object.entries(answers)) {
    if (!key.startsWith("block:") || a.type !== "choice") continue;
    const id = key.slice("block:".length);
    if (!(SELECTABLE_BLOCKS as readonly string[]).includes(id)) continue;
    const c = a as ChoiceAnswer;
    if (!(MODIFY_ACTIONS as readonly string[]).includes(c.choice) || c.choice === "keep") continue;
    if (typeof c.confidence !== "number" || c.confidence < THRESHOLDS.choiceConfidence) continue;
    out.set(id, c.choice as ModifyAction);
  }
  return out;
}

export interface ModifyResult {
  decisions: Map<string, ModifyAction>;
  usage?: { input_tokens: number; output_tokens: number };
}

export async function modifyWithJev(input: ModifyInput, opts: { apiKey: string; timeoutMs?: number }): Promise<ModifyResult> {
  const res = await fetch(TYPESAFE_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildModifyRequest(input)),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`TypeSafe API error ${res.status}: ${body || res.statusText}`);
  }
  const json = (await res.json()) as { answers?: Record<string, ChoiceAnswer>; usage?: ModifyResult["usage"] };
  return { decisions: routeModifyAnswers(json.answers ?? {}), usage: json.usage };
}

export interface AppliedModifications {
  harness: HarnessConfig;
  changes: { block: string; action: ModifyAction }[];
  refused: { block: string; action: ModifyAction; reason: string }[];
}

/** Apply decisions as structured edits. `locked: true` entries are never removed or weakened. */
export function applyModifications(
  harness: HarnessConfig,
  decisions: Map<string, ModifyAction>,
  facts: ProjectFacts | undefined,
  blocks: Pick<BuildingBlock, "id">[],
): AppliedModifications {
  const known = new Set(blocks.map((b) => b.id));
  const hooks: HarnessConfig["hooks"] = harness.hooks.map((h) => ({ ...h, params: { ...h.params } }));
  const changes: AppliedModifications["changes"] = [];
  const refused: AppliedModifications["refused"] = [];
  for (const [block, action] of decisions) {
    if (action === "keep" || !known.has(block)) continue;
    const idx = hooks.findIndex((h) => h.block === block);
    const existing = idx >= 0 ? hooks[idx] : undefined;
    if (existing?.locked && (action === "disable" || action === "ask")) {
      refused.push({ block, action, reason: `${block} is locked in harness.yaml; remove \`locked: true\` first` });
      continue;
    }
    if (action === "disable") {
      if (idx >= 0) { hooks.splice(idx, 1); changes.push({ block, action }); }
    } else if (action === "ask") {
      if (existing && existing.mode !== "ask") { existing.mode = "ask"; changes.push({ block, action }); }
    } else if (action === "enable") {
      if (existing) {
        if (existing.mode === "ask") { existing.mode = "block"; changes.push({ block, action }); }
        continue;
      }
      const params = defaultParamsFor(block, facts);
      if (params === null) {
        refused.push({ block, action, reason: `${block} needs a parameter the project detector could not supply; add it to harness.yaml by hand` });
        continue;
      }
      hooks.push({ block, params, mode: "block" });
      changes.push({ block, action });
    }
  }
  return { harness: { ...harness, hooks }, changes, refused };
}

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}
