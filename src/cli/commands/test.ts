import * as p from "@clack/prompts";
import chalk from "chalk";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { getRegisteredHooks, generateBlockTestCases, runTestCase } from "../harness-tester.js";
import { checkHarnessCommands } from "../command-checker.js";
import type { TestResult } from "../harness-tester.js";
import type { CommandCheckResult } from "../command-checker.js";
import { HarnessConfigSchema } from "../../core/harness-schema.js";
import { mergeEnforcementAndHooks } from "../../core/harness-converter.js";
import { builtinBlocks } from "../../catalog/blocks/index.js";
import type { HookEntry } from "../../catalog/types.js";

export interface TestCommandOptions {
  projectDir?: string;
}

export function formatCategoryName(category: string): string {
  const names: Record<string, string> = {
    "path-guard": "File guards",
    "command-guard": "Command guards",
    "branch-guard": "Branch guard",
    "lockfile-guard": "Lockfile guard",
    "secret-file-guard": "Secret file guard",
    "commit-test-gate": "Pre-commit test gate",
    "commit-typecheck-gate": "Pre-commit typecheck gate",
    "lint-on-save": "Lint on save",
    "format-on-save": "Format on save",
    "auto-pr": "Auto PR",
    "tdd-guard": "TDD Guard",
  };
  return names[category] ?? category;
}

export async function testCommand(options: TestCommandOptions = {}): Promise<{
  passed: number;
  failed: number;
  results: TestResult[];
  commandResults: CommandCheckResult[];
}> {
  const projectDir = options.projectDir ?? process.cwd();

  // 1. harness.yaml 읽기
  const harnessPath = path.join(projectDir, "harness.yaml");
  let hookEntries: HookEntry[] = [];

  try {
    const raw = await fs.readFile(harnessPath, "utf-8");
    const parsed = yaml.load(raw);
    const result = HarnessConfigSchema.safeParse(parsed);
    if (result.success) {
      // Merge enforcement-derived hooks with explicit hooks
      hookEntries = mergeEnforcementAndHooks(result.data);
    } else {
      console.log(chalk.yellow(`Warning: harness.yaml schema validation failed: ${result.error.message}`));
    }
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== "ENOENT") {
      console.log(chalk.red(`Error reading harness.yaml: ${error.message}`));
      process.exit(1);
    }
    // ENOENT: harness.yaml 없으면 settings.json만으로 진행
  }

  // 2. settings.json에서 등록된 hook 가져오기
  let hooks: Awaited<ReturnType<typeof getRegisteredHooks>>;
  try {
    hooks = await getRegisteredHooks(projectDir);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      console.log(chalk.red("harness not initialized. Run `omh init` first."));
    } else {
      console.log(chalk.red(`Failed to read settings.json: ${error.message}`));
    }
    process.exit(1);
  }

  if (hooks.length === 0) {
    console.log(chalk.yellow("No hooks registered in settings.json."));
    return { passed: 0, failed: 0, results: [], commandResults: [] };
  }

  // 3. 시뮬레이션 테스트 케이스 생성 + 실행
  p.intro(`${chalk.bgCyan(chalk.black(" omh test "))} ${chalk.dim("Harness dry-run verification")}`);

  // 현재 브랜치 가져오기
  let currentBranch: string | undefined;
  try {
    const { execFile: execFileCb } = await import("node:child_process");
    const { promisify: promisifyFn } = await import("node:util");
    const execFileAsync = promisifyFn(execFileCb);
    const { stdout } = await execFileAsync("git", ["branch", "--show-current"], { cwd: projectDir });
    currentBranch = stdout.trim() || undefined;
  } catch {
    // git 없으면 undefined
  }

  // Generate test cases from block-based hooks only
  const testCases = generateBlockTestCases(hookEntries, builtinBlocks, currentBranch);
  const results: TestResult[] = [];

  // 카테고리별 그룹핑
  const categories = [...new Set(testCases.map((tc) => tc.category))];

  for (const category of categories) {
    const casesInCategory = testCases.filter((tc) => tc.category === category);
    const categoryResults: TestResult[] = [];

    for (const tc of casesInCategory) {
      const result = await runTestCase(projectDir, tc);
      categoryResults.push(result);
      results.push(result);
    }

    // 카테고리 출력
    const lines = categoryResults.map((r) => {
      if (r.passed) {
        return `  ${chalk.green("✓")} ${r.testCase.name}`;
      } else {
        const hint = r.error ?? `expected ${r.testCase.expectation} but got ${r.actual}`;
        return `  ${chalk.red("✗")} ${r.testCase.name}\n    ${chalk.dim(hint)}`;
      }
    });
    p.note(lines.join("\n"), formatCategoryName(category));
  }

  // 4. 명령어 실행 가능 체크
  const commandResults = await checkHarnessCommands(hooks, projectDir);

  if (commandResults.length > 0) {
    const cmdLines = commandResults.map((r) => {
      if (r.executable) {
        return `  ${chalk.green("✓")} ${r.command} — executable`;
      } else {
        return `  ${chalk.red("✗")} ${r.command} — ${chalk.red("not found")}`;
      }
    });
    p.note(cmdLines.join("\n"), "Command checks");
  }

  // 5. 결과 요약
  const hookPassed = results.filter((r) => r.passed).length;
  const hookFailed = results.filter((r) => !r.passed).length;
  const cmdPassed = commandResults.filter((r) => r.executable).length;
  const cmdFailed = commandResults.filter((r) => !r.executable).length;

  const totalPassed = hookPassed + cmdPassed;
  const totalFailed = hookFailed + cmdFailed;
  const total = totalPassed + totalFailed;

  if (totalFailed === 0) {
    p.outro(chalk.green(`${totalPassed}/${total} checks passed ✓`));
  } else {
    p.outro(chalk.red(`${totalFailed}/${total} checks failed`));
    process.exit(1);
  }

  return { passed: totalPassed, failed: totalFailed, results, commandResults };
}
