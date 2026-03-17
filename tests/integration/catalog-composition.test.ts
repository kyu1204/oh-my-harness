import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultRegistry } from "../../src/catalog/registry.js";
import { convertHookEntries } from "../../src/catalog/converter.js";
import { generateHooks } from "../../src/generators/hooks.js";
import type { HookEntry } from "../../src/catalog/types.js";
import type { MergedConfig } from "../../src/core/preset-types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "omh-integ-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeMinimalConfig(
  preToolUse: Array<{ id: string; matcher: string; inline: string }>,
  postToolUse: Array<{ id: string; matcher: string; inline: string }> = [],
): MergedConfig {
  return {
    presets: [],
    variables: {},
    claudeMdSections: [],
    hooks: { preToolUse, postToolUse },
    settings: { permissions: { allow: [], deny: [] } },
  };
}

describe("catalog composition", () => {
  it("branch-guard + commit-test-gate + command-guard → 3 script files generated", async () => {
    const registry = await createDefaultRegistry();

    const entries: HookEntry[] = [
      { block: "branch-guard", params: { mainBranch: "main" } },
      { block: "commit-test-gate", params: { testCommand: "npx vitest run" } },
      { block: "command-guard", params: { patterns: ["rm -rf /", "sudo rm"] } },
    ];

    const result = await convertHookEntries(entries, registry, tmpDir);

    expect(result.errors).toHaveLength(0);
    expect(result.scripts.size).toBe(3);

    const scriptPaths = Array.from(result.scripts.keys());
    expect(scriptPaths.some((p) => p.endsWith("branch-guard.sh"))).toBe(true);
    expect(scriptPaths.some((p) => p.endsWith("commit-test-gate.sh"))).toBe(true);
    expect(scriptPaths.some((p) => p.endsWith("command-guard.sh"))).toBe(true);
  });

  it("generated hooksConfig is compatible with Claude Code settings format", async () => {
    const registry = await createDefaultRegistry();

    const entries: HookEntry[] = [
      { block: "branch-guard", params: {} },
      { block: "command-guard", params: { patterns: ["rm -rf /"] } },
    ];

    const result = await convertHookEntries(entries, registry, tmpDir);

    expect(result.errors).toHaveLength(0);

    // hooksConfig must be a plain object keyed by event name
    expect(typeof result.hooksConfig).toBe("object");
    expect(result.hooksConfig).not.toBeNull();

    // All entries under each event must have type "command" and a command string
    for (const [_event, hookList] of Object.entries(result.hooksConfig)) {
      expect(Array.isArray(hookList)).toBe(true);
      for (const entry of hookList) {
        expect(entry.type).toBe("command");
        expect(typeof entry.command).toBe("string");
        expect(entry.command.length).toBeGreaterThan(0);
      }
    }
  });

  it("each generated script contains the logger wrapper", async () => {
    const registry = await createDefaultRegistry();

    const entries: HookEntry[] = [
      { block: "commit-test-gate", params: { testCommand: "npm test" } },
      { block: "command-guard", params: { patterns: ["sudo rm"] } },
    ];

    const result = await convertHookEntries(entries, registry, tmpDir);
    expect(result.errors).toHaveLength(0);

    const scripts = Array.from(result.scripts.values());
    const config = makeMinimalConfig([
      { id: "commit-test-gate", matcher: "Bash", inline: scripts[0] },
      { id: "command-guard", matcher: "Bash", inline: scripts[1] },
    ]);

    const output = await generateHooks({ projectDir: tmpDir, config });

    expect(output.generatedFiles.length).toBe(2);

    for (const filePath of output.generatedFiles) {
      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("_OMH_EVENT");
      expect(content).toContain("_log_event");
    }
  });

  it("each generated script contains the correct event type", async () => {
    const config = makeMinimalConfig(
      [{ id: "branch-guard", matcher: "Bash", inline: "#!/bin/bash\nset -euo pipefail\nINPUT=$(cat)\nexit 0" }],
      [{ id: "post-hook", matcher: "Bash", inline: "#!/bin/bash\nset -euo pipefail\nINPUT=$(cat)\nexit 0" }],
    );

    const output = await generateHooks({ projectDir: tmpDir, config });

    expect(output.generatedFiles.length).toBe(2);

    const branchGuardFile = output.generatedFiles.find((f) => f.includes("branch-guard"));
    const postHookFile = output.generatedFiles.find((f) => f.includes("post-hook"));

    expect(branchGuardFile).toBeDefined();
    expect(postHookFile).toBeDefined();

    const preContent = await readFile(branchGuardFile!, "utf-8");
    const postContent = await readFile(postHookFile!, "utf-8");

    expect(preContent).toContain('"PreToolUse"');
    expect(postContent).toContain('"PostToolUse"');
  });

  it("hooksConfig has PreToolUse event key for preToolUse hooks", async () => {
    const config = makeMinimalConfig([
      { id: "my-guard", matcher: "Bash", inline: "#!/bin/bash\nexit 0" },
    ]);

    const output = await generateHooks({ projectDir: tmpDir, config });

    expect(output.hooksConfig).toHaveProperty("PreToolUse");
    expect(output.hooksConfig["PreToolUse"]).toHaveLength(1);
    expect(output.hooksConfig["PreToolUse"][0].matcher).toBe("Bash");
    expect(output.hooksConfig["PreToolUse"][0].hooks[0].type).toBe("command");
  });
});
