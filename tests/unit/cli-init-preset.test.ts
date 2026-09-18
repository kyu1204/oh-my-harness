import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { initCommand } from "../../src/cli/commands/init.js";

// `omh init "description"` without -y must confirm and proceed, never drop
// the description into the TUI (QA).
vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(async () => true),
  input: vi.fn(async () => ""),
}));

// #116 / #129: `omh init --preset <name>` needs no AI provider and no network;
// with TYPESAFE_API_KEY it lets Jev tune the preset to the description.

let dir: string;
let logs: string[];
const ENV_KEYS = ["TYPESAFE_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "HOME"];
let savedEnv: Record<string, string | undefined>;

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  dir = await mkdtemp(join(tmpdir(), "omh-init-preset-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "acme", scripts: { test: "vitest run", lint: "eslint ." }, devDependencies: { vitest: "^3", typescript: "^5" } }));
  await writeFile(join(dir, "tsconfig.json"), "{}");
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
  for (const k of ENV_KEYS) if (k !== "HOME") delete process.env[k];
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(dir, { recursive: true, force: true });
});

async function harness() {
  return yaml.load(await readFile(join(dir, "harness.yaml"), "utf-8")) as { hooks: { block: string; params?: Record<string, unknown> }[]; rules: { id: string }[] };
}

describe("omh init --preset", () => {
  it("strict: writes harness.yaml and generated files with no provider configured", async () => {
    await initCommand([], { preset: "strict", yes: true, projectDir: dir });
    const h = await harness();
    const ids = h.hooks.map((x) => x.block);
    expect(ids).toContain("tdd-guard");
    expect(ids).toContain("commit-test-gate");
    expect(h.hooks.find((x) => x.block === "commit-test-gate")!.params!.testCommand).toMatch(/vitest/);
    await access(join(dir, "CLAUDE.md"));
    await access(join(dir, ".omh", "hooks", "catalog-tdd-guard.sh"));
    expect(logs.join("\n")).toMatch(/preset: strict/);
  });

  it("minimal: no test gates even though a test command was detected", async () => {
    await initCommand([], { preset: "minimal", yes: true, projectDir: dir });
    const ids = (await harness()).hooks.map((x) => x.block);
    expect(ids).not.toContain("commit-test-gate");
    expect(ids).toContain("command-guard");
  });

  it("--preset stays deterministic and offline even when TYPESAFE_API_KEY and a description are present (review)", async () => {
    process.env.TYPESAFE_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => { throw new Error("network must not be used with --preset"); });
    vi.stubGlobal("fetch", fetchMock);
    await initCommand(["TypeScript API, TDD enforced"], { preset: "minimal", yes: true, projectDir: dir });
    expect(fetchMock).not.toHaveBeenCalled();
    const ids = (await harness()).hooks.map((x) => x.block);
    expect(ids).not.toContain("tdd-guard");
    expect(logs.join("\n")).toMatch(/preset: minimal/);
  });

  it("rejects an unknown preset name with the valid list", async () => {
    await expect(initCommand([], { preset: "yolo", yes: true, projectDir: dir })).rejects.toThrow(/minimal, safe, strict/);
  });

  it("with TYPESAFE_API_KEY, tunes the preset with Jev and reports the decisions", async () => {
    process.env.TYPESAFE_API_KEY = "test-key";
    const answers: Record<string, unknown> = { strictness: { type: "choice", choice: "strict", confidence: 0.9, probabilities: { strict: 0.9, safe: 0.1, minimal: 0 } } };
    for (const id of ["branch-guard", "command-guard", "path-guard", "commit-test-gate", "commit-typecheck-gate", "lockfile-guard", "secret-file-guard", "tdd-guard", "lint-on-save"]) answers[`block:${id}`] = { type: "noul", noul: 0.9 };
    for (const id of ["sql-guard", "format-on-save", "test-on-save", "auto-pr", "desktop-notify", "compact-context"]) answers[`block:${id}`] = { type: "noul", noul: 0.1 };
    answers["block:auto-pr"] = { type: "noul", noul: 0.05 };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 900, output_tokens: 40 } }), { status: 200 })));

    await initCommand(["TypeScript API, TDD enforced, no auto PRs"], { yes: true, projectDir: dir });
    const ids = (await harness()).hooks.map((x) => x.block);
    expect(ids).toContain("tdd-guard");
    expect(ids).not.toContain("auto-pr");
    expect(logs.join("\n")).toMatch(/Jev/);
    expect(logs.join("\n")).toMatch(/strict/);
  });

  it("with a description but neither a provider nor a key, points at --preset instead of failing on the provider", async () => {
    // HOME is redirected so no real ~/.omh/config.json can leak in (restored in afterEach)
    process.env.HOME = dir;
    await initCommand(["TypeScript API"], { yes: true, projectDir: dir });
    const ids = (await harness()).hooks.map((x) => x.block);
    expect(ids).toContain("commit-test-gate");   // fell back to the 'safe' preset
    expect(logs.join("\n")).toMatch(/--preset/);
  });
});

describe("omh init \"description\" without -y (QA)", () => {
  it("uses the non-interactive generator with a confirm prompt instead of the TUI", async () => {
    process.env.HOME = dir;
    await initCommand(["TypeScript API"], { projectDir: dir });
    const ids = (await harness()).hooks.map((x) => x.block);
    expect(ids).toContain("commit-test-gate");
    expect(logs.join("\n")).toMatch(/safe/);
  });
});
