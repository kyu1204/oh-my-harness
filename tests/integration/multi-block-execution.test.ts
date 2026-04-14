import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";
import { generateHooks, wrapWithLogger } from "../../src/generators/hooks.js";
import { readEvents } from "../../src/cli/event-logger.js";
import { renderTemplate } from "../../src/catalog/template-engine.js";
import { builtinBlocks } from "../../src/catalog/blocks/index.js";
import { harnessToMergedConfig } from "../../src/core/harness-converter.js";
import { harnessToMergedConfigV2 } from "../../src/core/harness-converter-v2.js";
import type { MergedConfig } from "../../src/core/preset-types.js";
import type { HarnessConfig } from "../../src/core/harness-schema.js";

function getBlock(id: string) {
  const block = builtinBlocks.find((b) => b.id === id);
  if (!block) throw new Error(`Block not found: ${id}`);
  return block;
}

function hasJq(): boolean {
  try {
    execSync("jq --version", { stdio: "ignore", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

interface HookResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runHookScript(scriptPath: string, stdin: string, cwd: string): HookResult {
  try {
    const stdout = execSync(`bash "${scriptPath}"`, {
      input: stdin,
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.status ?? 1,
    };
  }
}

function makeBaseHarness(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return {
    version: "1.0",
    project: { name: "test", stacks: [{ name: "ts", framework: "node", language: "typescript" }] },
    rules: [],
    enforcement: { preCommit: [], blockedPaths: [], blockedCommands: [], postSave: [] },
    hooks: [],
    permissions: { allow: [], deny: [] },
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "omh-multi-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 여러 PreToolUse 블록이 동일 matcher에 등록될 때
// ---------------------------------------------------------------------------

describe("multiple blocks with same matcher", () => {
  it("1. command-guard + branch-guard both Bash → hooksConfig has 2 PreToolUse entries", async () => {
    const renderedCommandGuard = renderTemplate(getBlock("command-guard").template, {
      patterns: ["rm -rf /"],
    });
    const renderedBranchGuard = renderTemplate(getBlock("branch-guard").template, {
      mainBranch: "main",
    });

    const config: MergedConfig = {
      presets: [],
      variables: {},
      claudeMdSections: [],
      hooks: {
        preToolUse: [
          { id: "command-guard", matcher: "Bash", inline: renderedCommandGuard },
          { id: "branch-guard", matcher: "Bash", inline: renderedBranchGuard },
        ],
        postToolUse: [],
      },
      settings: { permissions: { allow: [], deny: [] } },
    };

    const result = await generateHooks({ projectDir: tmpDir, config });

    expect(result.hooksConfig["PreToolUse"]).toBeDefined();
    expect(result.hooksConfig["PreToolUse"]).toHaveLength(2);
    expect(result.hooksConfig["PreToolUse"][0].matcher).toBe("Bash");
    expect(result.hooksConfig["PreToolUse"][1].matcher).toBe("Bash");
  });

  it("2. each block generates a separate script file", async () => {
    const renderedCommandGuard = renderTemplate(getBlock("command-guard").template, {
      patterns: ["rm -rf /"],
    });
    const renderedBranchGuard = renderTemplate(getBlock("branch-guard").template, {
      mainBranch: "main",
    });

    const config: MergedConfig = {
      presets: [],
      variables: {},
      claudeMdSections: [],
      hooks: {
        preToolUse: [
          { id: "command-guard", matcher: "Bash", inline: renderedCommandGuard },
          { id: "branch-guard", matcher: "Bash", inline: renderedBranchGuard },
        ],
        postToolUse: [],
      },
      settings: { permissions: { allow: [], deny: [] } },
    };

    const result = await generateHooks({ projectDir: tmpDir, config });

    const fileNames = result.generatedFiles.map((f) => basename(f));
    expect(fileNames).toContain("command-guard.sh");
    expect(fileNames).toContain("branch-guard.sh");

    // Verify files exist on disk
    for (const filePath of result.generatedFiles) {
      const info = await stat(filePath);
      expect(info.isFile()).toBe(true);
    }
  });

  it("3. same matcher → separate entries in hooksConfig (one per block)", async () => {
    const rendered = renderTemplate(getBlock("command-guard").template, {
      patterns: ["rm -rf /"],
    });
    const rendered2 = renderTemplate(getBlock("branch-guard").template, {
      mainBranch: "main",
    });

    const config: MergedConfig = {
      presets: [],
      variables: {},
      claudeMdSections: [],
      hooks: {
        preToolUse: [
          { id: "command-guard", matcher: "Bash", inline: rendered },
          { id: "branch-guard", matcher: "Bash", inline: rendered2 },
        ],
        postToolUse: [],
      },
      settings: { permissions: { allow: [], deny: [] } },
    };

    const result = await generateHooks({ projectDir: tmpDir, config });

    // Each block has its own entry, not merged
    const preToolUseEntries = result.hooksConfig["PreToolUse"];
    expect(preToolUseEntries).toHaveLength(2);
    const commands = preToolUseEntries.map((e) => e.hooks[0].command);
    expect(commands.some((c) => c.includes("command-guard.sh"))).toBe(true);
    expect(commands.some((c) => c.includes("branch-guard.sh"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PreToolUse + PostToolUse 혼합
// ---------------------------------------------------------------------------

describe("PreToolUse + PostToolUse mix", () => {
  it("4. command-guard (Pre) + lint-on-save (Post) → both event keys exist", async () => {
    const renderedCommandGuard = renderTemplate(getBlock("command-guard").template, {
      patterns: ["rm -rf /"],
    });
    const renderedLintOnSave = renderTemplate(getBlock("lint-on-save").template, {
      filePattern: "*.ts",
      command: "eslint --fix",
    });

    const config: MergedConfig = {
      presets: [],
      variables: {},
      claudeMdSections: [],
      hooks: {
        preToolUse: [
          { id: "command-guard", matcher: "Bash", inline: renderedCommandGuard },
        ],
        postToolUse: [
          { id: "lint-on-save", matcher: "Edit|Write", inline: renderedLintOnSave },
        ],
      },
      settings: { permissions: { allow: [], deny: [] } },
    };

    const result = await generateHooks({ projectDir: tmpDir, config });

    expect(result.hooksConfig["PreToolUse"]).toBeDefined();
    expect(result.hooksConfig["PostToolUse"]).toBeDefined();
    expect(result.hooksConfig["PreToolUse"]).toHaveLength(1);
    expect(result.hooksConfig["PostToolUse"]).toHaveLength(1);
  });

  it("5. each event type script contains correct _OMH_EVENT value", async () => {
    const renderedCommandGuard = renderTemplate(getBlock("command-guard").template, {
      patterns: ["rm -rf /"],
    });
    const renderedLintOnSave = renderTemplate(getBlock("lint-on-save").template, {
      filePattern: "*.ts",
      command: "eslint --fix",
    });

    const config: MergedConfig = {
      presets: [],
      variables: {},
      claudeMdSections: [],
      hooks: {
        preToolUse: [
          { id: "command-guard", matcher: "Bash", inline: renderedCommandGuard },
        ],
        postToolUse: [
          { id: "lint-on-save", matcher: "Edit|Write", inline: renderedLintOnSave },
        ],
      },
      settings: { permissions: { allow: [], deny: [] } },
    };

    await generateHooks({ projectDir: tmpDir, config });

    const hooksDir = join(tmpDir, ".claude/hooks");
    const preScript = await readFile(join(hooksDir, "command-guard.sh"), "utf-8");
    const postScript = await readFile(join(hooksDir, "lint-on-save.sh"), "utf-8");

    expect(preScript).toContain('_OMH_EVENT="PreToolUse"');
    expect(postScript).toContain('_OMH_EVENT="PostToolUse"');
  });
});

// ---------------------------------------------------------------------------
// 실제 실행: 여러 블록의 이벤트 로깅
// ---------------------------------------------------------------------------

describe("multi-block execution and event logging", () => {
  it.runIf(hasJq())("6. command-guard + path-guard sequential execution → 2 events recorded", async () => {

    const renderedCommandGuard = renderTemplate(getBlock("command-guard").template, {
      patterns: ["rm -rf /"],
    });
    const renderedPathGuard = renderTemplate(getBlock("path-guard").template, {
      blockedPaths: ["dist/"],
    });

    const cgScript = wrapWithLogger(renderedCommandGuard, "PreToolUse");
    const pgScript = wrapWithLogger(renderedPathGuard, "PreToolUse");

    const cgPath = join(tmpDir, "command-guard.sh");
    const pgPath = join(tmpDir, "path-guard.sh");

    await writeFile(cgPath, cgScript, { mode: 0o755 });
    await writeFile(pgPath, pgScript, { mode: 0o755 });

    // command-guard: allow (no dangerous pattern)
    const cgResult = runHookScript(cgPath, JSON.stringify({ tool_input: { command: "echo hello" } }), tmpDir);
    expect(cgResult.exitCode).toBe(0);
    // path-guard: allow (not blocked path)
    const pgResult = runHookScript(pgPath, JSON.stringify({ tool_input: { file_path: "src/index.ts" } }), tmpDir);
    expect(pgResult.exitCode).toBe(0);

    const events = await readEvents(tmpDir);
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it.runIf(hasJq())("7. one block → block, other → allow, events recorded with correct decisions", async () => {

    const renderedCommandGuard = renderTemplate(getBlock("command-guard").template, {
      patterns: ["rm -rf /"],
    });
    const renderedPathGuard = renderTemplate(getBlock("path-guard").template, {
      blockedPaths: ["dist/"],
    });

    const cgScript = wrapWithLogger(renderedCommandGuard, "PreToolUse");
    const pgScript = wrapWithLogger(renderedPathGuard, "PreToolUse");

    const cgPath = join(tmpDir, "command-guard.sh");
    const pgPath = join(tmpDir, "path-guard.sh");

    await writeFile(cgPath, cgScript, { mode: 0o755 });
    await writeFile(pgPath, pgScript, { mode: 0o755 });

    // command-guard: allow
    const cgResult = runHookScript(cgPath, JSON.stringify({ tool_input: { command: "echo hello" } }), tmpDir);
    expect(cgResult.exitCode).toBe(0);
    // path-guard: block (matches dist/)
    const pgResult = runHookScript(pgPath, JSON.stringify({ tool_input: { file_path: "dist/bundle.js" } }), tmpDir);
    expect(pgResult.exitCode).toBe(0);

    const events = await readEvents(tmpDir);

    const allowEvents = events.filter((e) => e.decision === "allow");
    const blockEvents = events.filter((e) => e.decision === "block");

    expect(allowEvents.length).toBeGreaterThanOrEqual(1);
    expect(blockEvents.length).toBeGreaterThanOrEqual(1);
    expect(blockEvents[0].reason).toContain("dist/");
  });
});

// ---------------------------------------------------------------------------
// enforcement → catalog hooks 변환
// ---------------------------------------------------------------------------

describe("enforcement auto-converted to catalog hooks", () => {
  it("8. harness with enforcement.preCommit + hooks → all converted to catalog hooks in MergedConfig", async () => {
    const harness = makeBaseHarness({
      enforcement: {
        preCommit: ["npm test"],
        blockedPaths: [],
        blockedCommands: [],
        postSave: [],
      },
      hooks: [
        { block: "command-guard", params: { patterns: ["rm -rf /"] } },
      ],
    });

    const result = await harnessToMergedConfigV2(harness);

    // enforcement.preCommit converted to catalog commit-test-gate
    const testGateHooks = result.hooks.preToolUse.filter((h) =>
      h.id === "catalog-commit-test-gate",
    );
    expect(testGateHooks).toHaveLength(1);

    // explicit hooks → command-guard catalog hook
    const catalogHooks = result.hooks.preToolUse.filter((h) =>
      h.id === "catalog-command-guard",
    );
    expect(catalogHooks).toHaveLength(1);
  });

  it("9. v1 returns empty hooks, v2 converts enforcement to catalog hooks", async () => {
    const harness = makeBaseHarness({
      enforcement: {
        preCommit: ["npm test"],
        blockedPaths: ["dist/"],
        blockedCommands: [],
        postSave: [],
      },
    });

    const v1 = harnessToMergedConfig(harness);
    const v2 = await harnessToMergedConfigV2(harness);

    // v1 no longer generates inline enforcement hooks
    expect(v1.hooks.preToolUse).toHaveLength(0);

    // v2 converts enforcement to catalog hooks
    const v2CatalogHooks = v2.hooks.preToolUse.filter((h) =>
      h.id.startsWith("catalog-"),
    );
    expect(v2CatalogHooks.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// hooks config 구조 검증
// ---------------------------------------------------------------------------

describe("hooksConfig structure validation", () => {
  it("10. hooksConfig matches Claude Code settings.json format", async () => {
    const rendered = renderTemplate(getBlock("command-guard").template, {
      patterns: ["rm -rf /"],
    });

    const config: MergedConfig = {
      presets: [],
      variables: {},
      claudeMdSections: [],
      hooks: {
        preToolUse: [
          { id: "command-guard", matcher: "Bash", inline: rendered },
        ],
        postToolUse: [],
      },
      settings: { permissions: { allow: [], deny: [] } },
    };

    const result = await generateHooks({ projectDir: tmpDir, config });

    // Top-level keys are event type strings
    expect(Object.keys(result.hooksConfig)).toContain("PreToolUse");

    const preToolUseEntries = result.hooksConfig["PreToolUse"];
    expect(Array.isArray(preToolUseEntries)).toBe(true);

    for (const entry of preToolUseEntries) {
      // Each entry has matcher and hooks array
      expect(typeof entry.matcher).toBe("string");
      expect(Array.isArray(entry.hooks)).toBe(true);

      for (const hook of entry.hooks) {
        // Each hook has type: "command" and command string
        expect(hook.type).toBe("command");
        expect(typeof hook.command).toBe("string");
        expect(hook.command).toMatch(/\.sh"?$/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 스크립트 격리
// ---------------------------------------------------------------------------

describe("script isolation", () => {
  it.runIf(hasJq())("11. each script is independently executable without other scripts", async () => {

    const renderedCommandGuard = renderTemplate(getBlock("command-guard").template, {
      patterns: ["rm -rf /"],
    });
    const renderedBranchGuard = renderTemplate(getBlock("branch-guard").template, {
      mainBranch: "main",
    });

    const config: MergedConfig = {
      presets: [],
      variables: {},
      claudeMdSections: [],
      hooks: {
        preToolUse: [
          { id: "command-guard", matcher: "Bash", inline: renderedCommandGuard },
          { id: "branch-guard", matcher: "Bash", inline: renderedBranchGuard },
        ],
        postToolUse: [],
      },
      settings: { permissions: { allow: [], deny: [] } },
    };

    await generateHooks({ projectDir: tmpDir, config });

    const hooksDir = join(tmpDir, ".claude/hooks");

    // Run command-guard alone — should not error
    const cgResult = runHookScript(
      join(hooksDir, "command-guard.sh"),
      JSON.stringify({ tool_input: { command: "echo hello" } }),
      tmpDir,
    );
    expect(cgResult.exitCode).toBe(0);
    expect(cgResult.stdout).not.toContain('"decision": "block"');

    // Run branch-guard alone — should not error (exits 0 on non-commit command)
    const bgResult = runHookScript(
      join(hooksDir, "branch-guard.sh"),
      JSON.stringify({ tool_input: { command: "echo hello" } }),
      tmpDir,
    );
    expect(bgResult.exitCode).toBe(0);
    expect(bgResult.stdout).not.toContain('"decision": "block"');
  });

  it("12. each generated script contains its own logger wrapper", async () => {
    const renderedCommandGuard = renderTemplate(getBlock("command-guard").template, {
      patterns: ["rm -rf /"],
    });
    const renderedBranchGuard = renderTemplate(getBlock("branch-guard").template, {
      mainBranch: "main",
    });

    const config: MergedConfig = {
      presets: [],
      variables: {},
      claudeMdSections: [],
      hooks: {
        preToolUse: [
          { id: "command-guard", matcher: "Bash", inline: renderedCommandGuard },
          { id: "branch-guard", matcher: "Bash", inline: renderedBranchGuard },
        ],
        postToolUse: [],
      },
      settings: { permissions: { allow: [], deny: [] } },
    };

    await generateHooks({ projectDir: tmpDir, config });

    const hooksDir = join(tmpDir, ".claude/hooks");
    const cgScript = await readFile(join(hooksDir, "command-guard.sh"), "utf-8");
    const bgScript = await readFile(join(hooksDir, "branch-guard.sh"), "utf-8");

    // Both scripts contain the logger definition
    const loggerMarker = "oh-my-harness event logger";
    expect(cgScript).toContain(loggerMarker);
    expect(bgScript).toContain(loggerMarker);

    // Both scripts define _log_event function
    expect(cgScript).toContain("_log_event()");
    expect(bgScript).toContain("_log_event()");

    // Both scripts write to events.jsonl
    expect(cgScript).toContain("events.jsonl");
    expect(bgScript).toContain("events.jsonl");
  });
});
