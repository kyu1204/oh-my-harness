import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { HarnessConfigSchema } from "../../src/core/harness-schema.js";
import { parseLedger } from "../../src/loop/ledger.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(REPO, "scripts", "loop-qa-fixture.sh");

describe("scripts/loop-qa-fixture.sh", () => {
  it("builds a runnable QA project for a runtime: ledger, four work orders, guard trap, synced harness", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omh-qa-"));
    execFileSync("bash", [SCRIPT, "claude", dir], { encoding: "utf-8", env: { ...process.env, OMH_QA_SKIP_SYNC: "" } });

    // harness.yaml parses and targets the runtime with the QA knobs
    const parsed = HarnessConfigSchema.safeParse(yaml.load(fs.readFileSync(path.join(dir, "harness.yaml"), "utf-8")));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.loop).toMatchObject({
      runtime: "claude", interval: 5, stallStreak: 2, blockedBackoff: 20, architectOnly: ["PROTECTED.md"],
    });

    // ledger: four open tasks
    const ledger = fs.readFileSync(path.join(dir, "WORKPLAN.md"), "utf-8");
    expect(parseLedger(ledger)).toEqual({ unchecked: 4, checked: 0, blocked: 0 });

    // work orders Q-1..Q-4, Q-3 is the guard trap on the architect-only file
    for (const id of ["Q-1", "Q-2", "Q-3", "Q-4"]) {
      expect(fs.existsSync(path.join(dir, "docs", "work-orders", `${id}.md`))).toBe(true);
    }
    expect(fs.readFileSync(path.join(dir, "docs", "work-orders", "Q-3.md"), "utf-8")).toContain("PROTECTED.md");
    expect(fs.existsSync(path.join(dir, "PROTECTED.md"))).toBe(true);

    // synced harness: hooks (incl. loop-guard) and the skill are in place, everything committed
    expect(fs.existsSync(path.join(dir, ".omh", "hooks", "catalog-loop-guard.sh"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".claude", "skills", "omh-loop", "SKILL.md"))).toBe(true);
    expect(execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf-8" }).trim()).toBe("");
    expect(execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf-8" }).trim()).toBe("main");
  }, 60_000);

  it("works without a built dist by falling back to tsx (CI runs tests unbuilt)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omh-qa-tsx-"));
    const out = execFileSync("bash", [SCRIPT, "pi", dir], { encoding: "utf-8", env: { ...process.env, OMH_QA_FORCE_TSX: "1" } });
    expect(out).toContain("sync via: tsx");
    expect(fs.existsSync(path.join(dir, ".omh", "hooks", "catalog-loop-guard.sh"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".claude", "skills", "omh-loop", "SKILL.md"))).toBe(true);
  }, 90_000);

  it("refuses to build inside a non-empty directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omh-qa-busy-"));
    fs.writeFileSync(path.join(dir, "precious.txt"), "keep");
    expect(() => execFileSync("bash", [SCRIPT, "claude", dir], { encoding: "utf-8", stdio: "pipe" })).toThrow();
    expect(fs.readFileSync(path.join(dir, "precious.txt"), "utf-8")).toBe("keep");
  });

  it("rejects an unknown runtime", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omh-qa-bad-"));
    expect(() => execFileSync("bash", [SCRIPT, "gemini", dir], { encoding: "utf-8", stdio: "pipe" })).toThrow();
  });
});
