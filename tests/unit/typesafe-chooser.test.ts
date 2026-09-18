import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  buildJevRequest,
  routeAnswers,
  applyChoices,
  chooseWithJev,
  resolveTypesafeApiKey,
  SELECTABLE_BLOCKS,
} from "../../src/nl/typesafe-chooser.js";
import { buildPresetHarness } from "../../src/core/presets.js";
import { HarnessConfigSchema } from "../../src/core/harness-schema.js";
import { builtinBlocks } from "../../src/catalog/blocks/index.js";
import type { ProjectFacts } from "../../src/detector/types.js";

// Recorded Jev responses for five project descriptions (scripts/record-jev-fixtures.ts).
// The request builder must stay byte-compatible with the recorded `request`,
// or the fixture is meaningless: the test compares both.
const FIXTURE_DIR = join(__dirname, "..", "fixtures", "jev");
const fixtures = existsSync(FIXTURE_DIR)
  ? readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), "utf-8")))
  : [];

const tsFacts: ProjectFacts = {
  languages: ["typescript"], frameworks: ["express"], packageManagers: ["npm"],
  testCommands: ["npx vitest run"], lintCommands: ["npx eslint --fix"], buildCommands: ["npm run build"],
  typecheckCommands: ["npx tsc --noEmit"], blockedPaths: ["dist/", "node_modules/"], detectedFiles: ["package.json"],
};

afterEach(() => vi.unstubAllGlobals());

describe("buildJevRequest", () => {
  it("asks one noul per selectable block plus a strictness choice, with facts in the state", () => {
    const req = buildJevRequest({ description: "TS API, TDD enforced", facts: tsFacts, blocks: builtinBlocks });
    expect(req.model).toBe("jev-latest");
    expect(req.state).toMatchObject({ user_description: "TS API, TDD enforced", detected_project_facts: expect.objectContaining({ languages: ["typescript"] }) });
    for (const id of SELECTABLE_BLOCKS) expect(req.questions[`block:${id}`]).toMatchObject({ type: "noul" });
    expect(req.questions.strictness).toMatchObject({ type: "choice", criteria: expect.objectContaining({ minimal: expect.any(String), safe: expect.any(String), strict: expect.any(String) }) });
    // always-on and loop-internal blocks are never asked
    for (const id of ["harness-guard", "no-verify-guard", "force-push-guard", "loop-guard", "worktree-setup"]) {
      expect(req.questions[`block:${id}`]).toBeUndefined();
    }
  });
});

describe("routeAnswers (confidence routing)", () => {
  it("on above 0.65, off below 0.35, undecided in between; strictness from the choice", () => {
    const r = routeAnswers({
      "block:tdd-guard": { type: "noul", noul: 0.91 },
      "block:auto-pr": { type: "noul", noul: 0.16 },
      "block:format-on-save": { type: "noul", noul: 0.5 },
      strictness: { type: "choice", choice: "strict", confidence: 0.9, probabilities: { strict: 0.9, safe: 0.1, minimal: 0 } },
    });
    expect(r.blocks.get("tdd-guard")).toBe("on");
    expect(r.blocks.get("auto-pr")).toBe("off");
    expect(r.blocks.get("format-on-save")).toBe("undecided");
    expect(r.strictness).toBe("strict");
  });

  it("falls back to 'safe' when the strictness choice is missing or low-confidence", () => {
    expect(routeAnswers({}).strictness).toBe("safe");
    expect(routeAnswers({ strictness: { type: "choice", choice: "minimal", confidence: 0.3, probabilities: {} } }).strictness).toBe("safe");
  });
});

describe("applyChoices", () => {
  it("adds 'on' blocks with params filled from the facts, removes 'off' blocks, leaves undecided as the preset had them", () => {
    const base = buildPresetHarness("safe", tsFacts);   // has lint-on-save, no tdd-guard, no auto-pr
    const out = applyChoices(base, {
      strictness: "safe",
      blocks: new Map([["tdd-guard", "on"], ["lint-on-save", "off"], ["commit-test-gate", "undecided"], ["auto-pr", "off"]]),
    }, tsFacts);
    const ids = out.hooks.map((h) => h.block);
    expect(ids).toContain("tdd-guard");
    expect(ids).not.toContain("lint-on-save");
    expect(ids).toContain("commit-test-gate");
    expect(ids).not.toContain("auto-pr");
    expect(HarnessConfigSchema.safeParse(out).success).toBe(true);
  });

  it("skips an 'on' block whose required params cannot be filled, and reports it", () => {
    const base = buildPresetHarness("minimal");
    const out = applyChoices(base, { strictness: "minimal", blocks: new Map([["commit-test-gate", "on"]]) }, undefined);
    expect(out.hooks.map((h) => h.block)).not.toContain("commit-test-gate");
    expect(out.skipped).toEqual([{ block: "commit-test-gate", reason: expect.stringMatching(/testCommand/) }]);
  });
});

describe("chooseWithJev against recorded responses", () => {
  it.skipIf(fixtures.length === 0)("reproduces the recorded selection for every fixture", async () => {
    for (const fx of fixtures) {
      const req = buildJevRequest({ description: fx.description, facts: fx.facts, blocks: builtinBlocks });
      expect(req, fx.name).toEqual(fx.request);
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(fx.response), { status: 200 })));
      const result = await chooseWithJev({ description: fx.description, facts: fx.facts, blocks: builtinBlocks }, { apiKey: "test" });
      const on = [...result.blocks].filter(([, v]) => v === "on").map(([k]) => k).sort();
      expect(on, fx.name).toEqual([...fx.expected.on].sort());
      for (const id of fx.expected.off) expect(result.blocks.get(id), `${fx.name}: ${id}`).toBe("off");
      expect(result.strictness, fx.name).toBe(fx.expected.strictness);
    }
  });

  it("sends the bearer key and surfaces HTTP errors with the status", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chooseWithJev({ description: "x", blocks: builtinBlocks }, { apiKey: "k" })).rejects.toThrow(/401/);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });
});

describe("resolveTypesafeApiKey", () => {
  it("prefers the environment, then a .env file in the project dir", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "omh-ts-key-"));
    expect(resolveTypesafeApiKey(dir, {})).toBeUndefined();
    writeFileSync(join(dir, ".env"), "OTHER=1\nTYPESAFE_API_KEY=from-file\n");
    expect(resolveTypesafeApiKey(dir, {})).toBe("from-file");
    expect(resolveTypesafeApiKey(dir, { TYPESAFE_API_KEY: "from-env" })).toBe("from-env");
  });
});
