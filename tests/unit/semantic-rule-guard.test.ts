import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { execSync, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { semanticRuleGuard } from "../../src/catalog/blocks/semantic-rule-guard.js";
import { builtinBlocks } from "../../src/catalog/blocks/index.js";
import { renderTemplate } from "../../src/catalog/template-engine.js";
import { wrapWithLogger } from "../../src/generators/hooks.js";

// #144: rules marked enforce: true are judged by Jev on every Bash/Edit/Write
// call. Tests run against a local fake TypeSafe endpoint (OMH_TYPESAFE_ENDPOINT).

let server: http.Server;
let endpoint: string;
let lastBody: Record<string, unknown> | undefined;
let answersFor: (body: Record<string, unknown>) => Record<string, unknown>;
let dir: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      lastBody = JSON.parse(raw);
      if (req.headers.authorization !== "Bearer test-key") { res.writeHead(401); res.end("{}"); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ model: "jev-test", answers: answersFor(lastBody!), usage: { input_tokens: 10, output_tokens: 1 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/systemone`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omh-srg-"));
  lastBody = undefined;
  answersFor = () => ({});
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function hasJq(): boolean {
  try { execSync("jq --version", { stdio: "pipe" }); return true; } catch { return false; }
}

async function guard(params: Record<string, unknown>, mode: "block" | "ask" = "block") {
  const p = join(dir, "srg.sh");
  await writeFile(p, wrapWithLogger(renderTemplate(semanticRuleGuard.template, params), "PreToolUse", dir, mode), { mode: 0o755 });
  return p;
}
// async on purpose: the fake TypeSafe server runs in this same process, so a
// synchronous exec would block the event loop and the hook would time out.
function call(script: string, input: object, env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("/bin/bash", [script], {
      cwd: dir, timeout: 15_000,
      env: { ...process.env, TYPESAFE_API_KEY: "test-key", OMH_TYPESAFE_ENDPOINT: endpoint, ...env },
    });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", () => {});
    child.on("close", () => resolve(out));
    child.stdin.end(JSON.stringify(input));
  });
}
const RULES = ["Do not add npm dependencies without asking", "Never call the payment API from a test"];
const bash = (command: string) => ({ tool_name: "Bash", tool_input: { command }, transcript_path: "/x" });

describe("semanticRuleGuard block", () => {
  it("has correct metadata and is registered", () => {
    expect(semanticRuleGuard.id).toBe("semantic-rule-guard");
    expect(semanticRuleGuard.event).toBe("PreToolUse");
    expect(semanticRuleGuard.matcher).toBe("Bash|Edit|Write|MultiEdit");
    expect(semanticRuleGuard.canBlock).toBe(true);
    expect(semanticRuleGuard.params.map((p) => p.name)).toEqual(["rules", "blockAbove", "askAbove"]);
    expect(builtinBlocks.map((b) => b.id)).toContain("semantic-rule-guard");
    expect(semanticRuleGuard.explain?.change).toBeTruthy();
  });
});

describe.skipIf(!hasJq())("semantic-rule-guard execution", () => {
  it("sends one noul per rule with the tool call as state, and blocks above blockAbove", async () => {
    answersFor = () => ({ "rule:1": { type: "noul", noul: 0.96 }, "rule:2": { type: "noul", noul: 0.02 } });
    const s = await guard({ rules: RULES, blockAbove: 0.9, askAbove: 0.6 });
    const out = JSON.parse((await call(s, bash("npm install lodash"))).trim());
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/Do not add npm dependencies/);
    expect(out.reason).toMatch(/0\.96/);
    expect(lastBody).toMatchObject({ model: "jev-latest", state: { tool: "Bash", command: "npm install lodash" } });
    expect(Object.keys(lastBody!.questions as object)).toEqual(["rule:1", "rule:2"]);
  });

  it("allows below askAbove", async () => {
    answersFor = () => ({ "rule:1": { type: "noul", noul: 0.1 }, "rule:2": { type: "noul", noul: 0.05 } });
    const s = await guard({ rules: RULES, blockAbove: 0.9, askAbove: 0.6 });
    expect((await call(s, bash("npm test"))).trim()).toBe("");
  });

  it("asks in the middle band on Claude, and allows with a warning elsewhere", async () => {
    answersFor = () => ({ "rule:1": { type: "noul", noul: 0.7 }, "rule:2": { type: "noul", noul: 0.1 } });
    const s = await guard({ rules: RULES, blockAbove: 0.9, askAbove: 0.6 });
    const claude = JSON.parse((await call(s, bash("npm install left-pad"))).trim());
    expect(claude.hookSpecificOutput).toMatchObject({ permissionDecision: "ask" });
    expect(claude.hookSpecificOutput.permissionDecisionReason).toMatch(/0\.70?/);
    // Codex payload has no transcript_path: no ask available, allow and log
    expect((await call(s, { tool_name: "Bash", tool_input: { command: "npm install left-pad" } })).trim()).toBe("");
    const events = (await readFile(join(dir, ".omh", "state", "events.jsonl"), "utf-8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(events.at(-1)).toMatchObject({ decision: "allow", reason: expect.stringMatching(/warn/) });
  });

  it("describes an Edit by path and the new text, truncated", async () => {
    answersFor = () => ({ "rule:1": { type: "noul", noul: 0.0 }, "rule:2": { type: "noul", noul: 0.0 } });
    const s = await guard({ rules: RULES, blockAbove: 0.9, askAbove: 0.6 });
    await call(s, { tool_name: "Edit", tool_input: { file_path: "src/pay.test.ts", old_string: "a", new_string: "x".repeat(10_000) }, transcript_path: "/x" });
    expect(lastBody!.state).toMatchObject({ tool: "Edit", file_path: "src/pay.test.ts" });
    expect(String((lastBody!.state as Record<string, string>).new_string).length).toBeLessThanOrEqual(4000);
  });

  it("never blocks without a key or when the API fails, and says why in the log", async () => {
    answersFor = () => ({ "rule:1": { type: "noul", noul: 0.99 } });
    const s = await guard({ rules: RULES, blockAbove: 0.9, askAbove: 0.6 });
    expect((await call(s, bash("npm install evil"), { TYPESAFE_API_KEY: "" })).trim()).toBe("");
    expect((await call(s, bash("npm install evil"), { OMH_TYPESAFE_ENDPOINT: "http://127.0.0.1:9/v1/systemone" })).trim()).toBe("");
    const events = (await readFile(join(dir, ".omh", "state", "events.jsonl"), "utf-8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(events.map((e) => e.reason)).toEqual(expect.arrayContaining([expect.stringMatching(/skipped: no TYPESAFE_API_KEY/), expect.stringMatching(/skipped: TypeSafe API/)]));
  });

  it("does nothing for tools it does not judge", async () => {
    const s = await guard({ rules: RULES, blockAbove: 0.9, askAbove: 0.6 });
    expect((await call(s, { tool_name: "Read", tool_input: { file_path: "x" }, transcript_path: "/x" })).trim()).toBe("");
    expect(lastBody).toBeUndefined();
  });
});
