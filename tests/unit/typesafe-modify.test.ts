import { describe, it, expect, vi, afterEach } from "vitest";
import { buildModifyRequest, routeModifyAnswers, applyModifications, modifyWithJev, MODIFY_ACTIONS } from "../../src/nl/typesafe-modify.js";
import { HarnessConfigSchema } from "../../src/core/harness-schema.js";
import { builtinBlocks } from "../../src/catalog/blocks/index.js";
import type { ProjectFacts } from "../../src/detector/types.js";

// #118: `omh modify "request"` edits harness.yaml through Jev choice questions
// (enable / disable / ask / keep per block). Nothing is generated as text.

const facts: ProjectFacts = {
  languages: ["typescript"], frameworks: [], packageManagers: ["npm"], testCommands: ["npm test"], lintCommands: ["npx eslint --fix"],
  buildCommands: [], typecheckCommands: ["npx tsc --noEmit"], blockedPaths: ["dist/"], detectedFiles: [],
};
const base = () => HarnessConfigSchema.parse({
  version: "1.0",
  hooks: [
    { block: "branch-guard", params: {} },
    { block: "commit-test-gate", params: { testCommand: "npm test" } },
    { block: "auto-pr", params: {} },
    { block: "tdd-guard", params: {}, locked: true },
  ],
});

afterEach(() => vi.unstubAllGlobals());

describe("buildModifyRequest", () => {
  it("asks one choice per selectable block with the current state in the state, and lists the actions", () => {
    const req = buildModifyRequest({ request: "turn off auto PRs and make the test gate ask instead of block", harness: base(), blocks: builtinBlocks });
    expect(req.model).toBe("jev-latest");
    expect(req.state).toMatchObject({ request: expect.stringMatching(/auto PRs/), currently_enabled: expect.arrayContaining(["branch-guard", "auto-pr"]) });
    expect(req.questions["block:auto-pr"]).toMatchObject({ type: "choice", criteria: expect.objectContaining(Object.fromEntries(MODIFY_ACTIONS.map((a) => [a, expect.any(String)]))) });
    expect(req.questions["block:harness-guard"]).toBeUndefined();   // always-on, never asked
  });
});

describe("routeModifyAnswers", () => {
  it("keeps only confident non-keep decisions", () => {
    const r = routeModifyAnswers({
      "block:auto-pr": { type: "choice", choice: "disable", confidence: 0.9, probabilities: {} },
      "block:commit-test-gate": { type: "choice", choice: "ask", confidence: 0.8, probabilities: {} },
      "block:tdd-guard": { type: "choice", choice: "disable", confidence: 0.3, probabilities: {} },   // too unsure
      "block:sql-guard": { type: "choice", choice: "keep", confidence: 0.95, probabilities: {} },
      "block:made-up": { type: "choice", choice: "enable", confidence: 0.99, probabilities: {} },
    });
    expect([...r.entries()]).toEqual([["auto-pr", "disable"], ["commit-test-gate", "ask"]]);
  });
});

describe("applyModifications", () => {
  it("removes, adds with detector params, switches mode, and refuses to weaken locked entries", () => {
    const out = applyModifications(base(), new Map([
      ["auto-pr", "disable"],
      ["commit-test-gate", "ask"],
      ["lint-on-save", "enable"],
      ["tdd-guard", "disable"],       // locked
      ["branch-guard", "keep"],
    ]), facts, builtinBlocks);
    const ids = out.harness.hooks.map((h) => h.block);
    expect(ids).not.toContain("auto-pr");
    expect(ids).toContain("lint-on-save");
    expect(out.harness.hooks.find((h) => h.block === "lint-on-save")!.params).toMatchObject({ command: "npx eslint --fix" });
    expect(out.harness.hooks.find((h) => h.block === "commit-test-gate")!.mode).toBe("ask");
    expect(ids).toContain("tdd-guard");
    expect(out.changes.map((c) => `${c.block}:${c.action}`)).toEqual(["auto-pr:disable", "commit-test-gate:ask", "lint-on-save:enable"]);
    expect(out.refused).toEqual([{ block: "tdd-guard", action: "disable", reason: expect.stringMatching(/locked/) }]);
    expect(HarnessConfigSchema.safeParse(out.harness).success).toBe(true);
  });

  it("reports blocks it could not enable for lack of params, and is a no-op for enable on an enabled block", () => {
    const out = applyModifications(base(), new Map([["commit-typecheck-gate", "enable"], ["branch-guard", "enable"]]), undefined, builtinBlocks);
    expect(out.refused[0]).toMatchObject({ block: "commit-typecheck-gate", action: "enable" });
    expect(out.changes).toEqual([]);
  });
});

describe("modifyWithJev", () => {
  it("posts the request with the bearer key and routes the answers", async () => {
    const answers = { "block:auto-pr": { type: "choice", choice: "disable", confidence: 0.9, probabilities: {} } };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answers, usage: { input_tokens: 500, output_tokens: 10 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await modifyWithJev({ request: "no more auto PRs", harness: base(), blocks: builtinBlocks }, { apiKey: "k" });
    expect(r.decisions.get("auto-pr")).toBe("disable");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });
});
