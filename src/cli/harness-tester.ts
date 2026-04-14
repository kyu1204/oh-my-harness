import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { HookEntry, BuildingBlock } from "../catalog/types.js";
import { applyDefaults } from "../catalog/template-engine.js";

export interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface HookResult {
  decision: "block" | "allow";
  reason?: string;
}

export interface TestCase {
  name: string;
  category: string;
  hookScript: string;
  input: HookInput;
  expectation: "block" | "allow";
  setup?: (projectDir: string) => Promise<void>;
  teardown?: (projectDir: string) => Promise<void>;
}

export interface TestResult {
  testCase: TestCase;
  actual: "block" | "allow";
  passed: boolean;
  reason?: string;
  error?: string;
}

// 핵심 함수: hook 스크립트에 JSON stdin을 넣고 결과 파싱
export async function simulateHook(
  hookPath: string,
  input: HookInput,
  cwd?: string,
): Promise<HookResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve({ decision: "allow" });
    }, 5000);

    const child = spawn("bash", [hookPath], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.on("close", () => {
      clearTimeout(timer);
      const trimmed = stdout.trim();
      if (!trimmed) {
        resolve({ decision: "allow" });
        return;
      }
      // stdout에서 {"decision":"block","reason":"..."} 찾기
      const jsonMatch = trimmed.match(/\{[^}]*"decision"\s*:\s*"block"[^}]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as { decision: string; reason?: string };
          resolve({ decision: "block", reason: parsed.reason });
        } catch {
          resolve({ decision: "allow" });
        }
        return;
      }
      resolve({ decision: "allow" });
    });

    child.on("error", () => {
      clearTimeout(timer);
      resolve({ decision: "allow" });
    });

    // EPIPE 방지: 자식 프로세스가 이미 종료된 경우 stdin 에러 무시
    child.stdin.on("error", () => {});
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

// settings.json에서 등록된 hook 스크립트 목록 가져오기
export async function getRegisteredHooks(
  projectDir: string,
): Promise<{ event: string; matcher: string; command: string }[]> {
  const settingsPath = path.join(projectDir, ".claude", "settings.json");
  const raw = await fs.readFile(settingsPath, "utf-8");
  const settings = JSON.parse(raw) as {
    hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ type: string; command?: string }> }>>;
  };

  const hooks: { event: string; matcher: string; command: string }[] = [];

  for (const event of ["PreToolUse", "PostToolUse"]) {
    const eventHooks = settings.hooks?.[event];
    if (!Array.isArray(eventHooks)) continue;
    for (const entry of eventHooks) {
      const matcher = entry.matcher ?? "";
      for (const hook of entry.hooks ?? []) {
        if (hook.type === "command" && hook.command) {
          hooks.push({ event, matcher, command: hook.command });
        }
      }
    }
  }

  return hooks;
}

// 테스트 실행
export async function runTestCase(
  projectDir: string,
  testCase: TestCase,
): Promise<TestResult> {
  const hookPath = path.join(projectDir, testCase.hookScript);

  try {
    await fs.access(hookPath);
  } catch {
    if (testCase.teardown) await testCase.teardown(projectDir);
    return {
      testCase,
      actual: "allow",
      passed: false,
      error: `Hook script not found: ${testCase.hookScript}`,
    };
  }

  if (testCase.setup) await testCase.setup(projectDir);

  try {
    const result = await simulateHook(hookPath, testCase.input, projectDir);
    const passed = result.decision === testCase.expectation;

    return {
      testCase,
      actual: result.decision,
      passed,
      reason: result.reason,
      error: passed ? undefined : `expected ${testCase.expectation} but got ${result.decision}`,
    };
  } finally {
    if (testCase.teardown) await testCase.teardown(projectDir);
  }
}

// 블록 기반 테스트 케이스 생성
export function generateBlockTestCases(
  hookEntries: HookEntry[],
  blocks: BuildingBlock[],
  currentBranch?: string,
  registeredHooks?: { event: string; matcher: string; command: string }[],
): TestCase[] {
  const cases: TestCase[] = [];

  for (const entry of hookEntries) {
    const block = blocks.find((b) => b.id === entry.block);
    if (!block) continue;
    if (!block.canBlock) continue;

    const params = applyDefaults(block, entry.params);
    // Find actual script path from registered hooks, fallback to catalog- prefix
    // Map block ids to enforcement script name patterns
    const blockIdAliases: Record<string, string[]> = {
      "path-guard": ["path-guard", "file-guard"],
      "command-guard": ["command-guard"],
      "branch-guard": ["branch-guard"],
      "lockfile-guard": ["lockfile-guard"],
      "secret-file-guard": ["secret-file-guard"],
      "tdd-guard": ["tdd-guard"],
    };
    const aliases = blockIdAliases[block.id] ?? [block.id];
    const matchedHook = registeredHooks?.find((h) => {
      const scriptName = h.command.replace(/^bash\s+/, "").replace(/^"|"$/g, "");
      return aliases.some((alias) => scriptName.includes(alias));
    });
    const hookScript = matchedHook
      ? matchedHook.command.replace(/^bash\s+/, "").replace(/^"|"$/g, "")
      : `.claude/hooks/catalog-${block.id}.sh`;

    switch (block.id) {
      case "path-guard": {
        const blockedPaths = (params.blockedPaths as string[]) ?? [];
        for (const blocked of blockedPaths) {
          const testPath = blocked.endsWith("/")
            ? `${blocked}test-file.js`
            : blocked.startsWith("*")
              ? `test${blocked.slice(1)}`
              : blocked;
          cases.push({
            name: `${testPath} → BLOCKED`,
            category: "path-guard",
            hookScript,
            input: { tool_name: "Edit", tool_input: { file_path: testPath } },
            expectation: "block",
          });
        }
        cases.push({
          name: "src/index.ts → ALLOWED",
          category: "path-guard",
          hookScript,
          input: { tool_name: "Edit", tool_input: { file_path: "src/index.ts" } },
          expectation: "allow",
        });
        break;
      }

      case "command-guard": {
        const patterns = (params.patterns as string[]) ?? [];
        for (const pattern of patterns) {
          cases.push({
            name: `"${pattern}" → BLOCKED`,
            category: "command-guard",
            hookScript,
            input: { tool_name: "Bash", tool_input: { command: pattern } },
            expectation: "block",
          });
        }
        cases.push({
          name: '"npm test" → ALLOWED',
          category: "command-guard",
          hookScript,
          input: { tool_name: "Bash", tool_input: { command: "npm test" } },
          expectation: "allow",
        });
        break;
      }

      case "branch-guard": {
        const isProtected = currentBranch === "main" || currentBranch === "master";
        cases.push({
          name: `git commit on ${currentBranch ?? "unknown"} → ${isProtected ? "BLOCKED" : "ALLOWED"}`,
          category: "branch-guard",
          hookScript,
          input: { tool_name: "Bash", tool_input: { command: "git commit -m 'test'" } },
          expectation: isProtected ? "block" : "allow",
        });
        break;
      }

      case "lockfile-guard": {
        const lockfiles = (params.lockfiles as string[]) ?? ["package-lock.json"];
        for (const lf of lockfiles) {
          cases.push({
            name: `${lf} → BLOCKED`,
            category: "lockfile-guard",
            hookScript,
            input: { tool_name: "Edit", tool_input: { file_path: lf } },
            expectation: "block",
          });
        }
        cases.push({
          name: "package.json → ALLOWED",
          category: "lockfile-guard",
          hookScript,
          input: { tool_name: "Edit", tool_input: { file_path: "package.json" } },
          expectation: "allow",
        });
        break;
      }

      case "secret-file-guard": {
        cases.push({
          name: ".env → BLOCKED",
          category: "secret-file-guard",
          hookScript,
          input: { tool_name: "Edit", tool_input: { file_path: ".env" } },
          expectation: "block",
        });
        cases.push({
          name: "src/app.ts → ALLOWED",
          category: "secret-file-guard",
          hookScript,
          input: { tool_name: "Edit", tool_input: { file_path: "src/app.ts" } },
          expectation: "allow",
        });
        break;
      }

      case "tdd-guard": {
        const stateFile = ".claude/hooks/.state/edit-history.json";
        const srcPat = (params.srcPattern as string) ?? "\\.(ts|tsx|js|jsx)$";
        const testPat = (params.testPattern as string) ?? "\\.(test|spec)\\.(ts|tsx|js|jsx)$";
        // Derive sample file extensions from patterns
        const srcExt = srcPat.includes(".py") ? ".py" : ".ts";
        const testFile = testPat.includes("test_") ? `test_example${srcExt}` : `example.test${srcExt}`;
        const srcFile = `src/example${srcExt}`;

        // block case: source file without prior test edit
        cases.push({
          name: `${srcFile} without test → BLOCKED`,
          category: "tdd-guard",
          hookScript,
          input: { tool_name: "Edit", tool_input: { file_path: srcFile } },
          expectation: "block",
          setup: async (projectDir: string) => {
            const historyPath = path.join(projectDir, stateFile);
            try {
              await fs.unlink(historyPath);
            } catch {
              // file may not exist
            }
          },
          teardown: async (projectDir: string) => {
            const historyPath = path.join(projectDir, stateFile);
            try {
              await fs.unlink(historyPath);
            } catch {
              // file may not exist
            }
          },
        });

        // allow case: test file edit
        cases.push({
          name: `${testFile} → ALLOWED`,
          category: "tdd-guard",
          hookScript,
          input: { tool_name: "Edit", tool_input: { file_path: testFile } },
          expectation: "allow",
          setup: async (projectDir: string) => {
            const historyPath = path.join(projectDir, stateFile);
            const stateDir = path.dirname(historyPath);
            await fs.mkdir(stateDir, { recursive: true });
            await fs.writeFile(historyPath, JSON.stringify({ edits: [] }));
          },
          teardown: async (projectDir: string) => {
            const historyPath = path.join(projectDir, stateFile);
            try {
              await fs.unlink(historyPath);
            } catch {
              // file may not exist
            }
          },
        });

        // allow case: non-code file
        cases.push({
          name: "README.md → ALLOWED",
          category: "tdd-guard",
          hookScript,
          input: { tool_name: "Edit", tool_input: { file_path: "README.md" } },
          expectation: "allow",
        });
        break;
      }
    }
  }

  return cases;
}
