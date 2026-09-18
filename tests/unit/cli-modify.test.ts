import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { modifyCommand } from "../../src/cli/commands/modify.js";

// #118: `omh modify "request"` — Jev decides per block, the command shows the
// change set, writes harness.yaml (unless --dry-run) and regenerates.

vi.mock("@inquirer/prompts", () => ({ confirm: vi.fn(async () => true), input: vi.fn(async () => "") }));

let dir: string;
let logs: string[];
const ENV = ["TYPESAFE_API_KEY", "HOME"];
let saved: Record<string, string | undefined>;

async function harness() {
  return yaml.load(await fs.readFile(path.join(dir, "harness.yaml"), "utf-8")) as { hooks: { block: string; mode?: string; locked?: boolean }[] };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-modify-"));
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.HOME = dir;
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "acme", scripts: { test: "vitest run", lint: "eslint ." }, devDependencies: { vitest: "^3", typescript: "^5" } }));
  await fs.writeFile(path.join(dir, "tsconfig.json"), "{}");
  await fs.writeFile(path.join(dir, "harness.yaml"), yaml.dump({
    version: "1.0",
    hooks: [{ block: "branch-guard", params: {} }, { block: "auto-pr", params: {} }, { block: "tdd-guard", params: {}, locked: true }],
  }));
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await fs.rm(dir, { recursive: true, force: true });
});

function stubJev(answers: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ answers, usage: { input_tokens: 700, output_tokens: 20 } }), { status: 200 })));
}

describe("modifyCommand", () => {
  it("applies confident decisions, writes harness.yaml and regenerates", async () => {
    process.env.TYPESAFE_API_KEY = "k";
    stubJev({
      "block:auto-pr": { type: "choice", choice: "disable", confidence: 0.9, probabilities: {} },
      "block:commit-test-gate": { type: "choice", choice: "enable", confidence: 0.85, probabilities: {} },
      "block:tdd-guard": { type: "choice", choice: "disable", confidence: 0.9, probabilities: {} },
    });
    const r = await modifyCommand(["drop auto PRs, run tests before commits, and stop the TDD nagging"], { projectDir: dir, yes: true });
    expect(r.exitCode).toBe(0);
    const h = await harness();
    const ids = h.hooks.map((x) => x.block);
    expect(ids).not.toContain("auto-pr");
    expect(ids).toContain("commit-test-gate");
    expect(ids).toContain("tdd-guard");   // locked
    expect(logs.join("\n")).toMatch(/locked/);
    await fs.access(path.join(dir, ".omh", "hooks", "catalog-commit-test-gate.sh"));
  });

  it("--dry-run prints the change set and writes nothing", async () => {
    process.env.TYPESAFE_API_KEY = "k";
    stubJev({ "block:auto-pr": { type: "choice", choice: "disable", confidence: 0.9, probabilities: {} } });
    const before = await fs.readFile(path.join(dir, "harness.yaml"), "utf-8");
    const r = await modifyCommand(["no auto PRs"], { projectDir: dir, dryRun: true });
    expect(r.exitCode).toBe(0);
    expect(logs.join("\n")).toMatch(/disable.*auto-pr|auto-pr.*disable/);
    expect(await fs.readFile(path.join(dir, "harness.yaml"), "utf-8")).toBe(before);
  });

  it("says so when Jev finds nothing to change", async () => {
    process.env.TYPESAFE_API_KEY = "k";
    stubJev({ "block:auto-pr": { type: "choice", choice: "keep", confidence: 0.9, probabilities: {} } });
    const r = await modifyCommand(["hello"], { projectDir: dir, yes: true });
    expect(r.exitCode).toBe(0);
    expect(logs.join("\n")).toMatch(/No changes/);
  });

  it("fails with a hint when there is no TYPESAFE_API_KEY, and when harness.yaml is missing", async () => {
    delete process.env.TYPESAFE_API_KEY;
    const r = await modifyCommand(["x"], { projectDir: dir });
    expect(r.exitCode).toBe(1);
    expect(logs.join("\n")).toMatch(/TYPESAFE_API_KEY/);
    process.env.TYPESAFE_API_KEY = "k";
    await fs.rm(path.join(dir, "harness.yaml"));
    const r2 = await modifyCommand(["x"], { projectDir: dir });
    expect(r2.exitCode).toBe(1);
    expect(logs.join("\n")).toMatch(/harness\.yaml/);
  });
});
