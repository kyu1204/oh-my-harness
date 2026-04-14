import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CommandCheckResult {
  command: string;
  category: string; // "commit-test-gate" | "commit-typecheck-gate" | "lint-on-save" | "format-on-save" | "auto-pr"
  executable: boolean;
  error?: string;
}

// 명령어에서 바이너리 추출 (첫 토큰, 래퍼 처리)
export function extractExecutable(command: string): string {
  let parts = command.trim().split(/\s+/);
  // Skip environment variable prefixes (KEY=VALUE)
  while (parts.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[0])) {
    parts = parts.slice(1);
  }
  // npm run X → npm
  // npx X → npx
  // bash script.sh → bash
  return parts[0] ?? "";
}

// 명령어 실행 가능 여부 확인
export async function checkCommandExecutable(binary: string): Promise<boolean> {
  try {
    await execFileAsync("which", [binary]);
    return true;
  } catch {
    return false;
  }
}

// pre-commit hook 스크립트에서 실행되는 명령어 추출
export function extractPreCommitCommands(hookContent: string): string[] {
  const commands: string[] = [];
  // 패턴: if ! <command> 또는 직접 명령 실행
  const matches = hookContent.matchAll(/if\s+!\s+(.+?)\s+>&?2/g);
  for (const match of matches) {
    commands.push(match[1].trim());
  }
  return commands;
}

// post-save hook 스크립트에서 실행되는 명령어 추출
export function extractPostSaveCommands(hookContent: string): string[] {
  const commands: string[] = [];
  // 패턴: <command> "$FILE_PATH" 또는 <command> --fix "$FILE_PATH"
  const lines = hookContent.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    // eslint --fix "$FILE_PATH" 패턴
    if (
      trimmed.includes("$FILE_PATH") &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("if") &&
      !trimmed.startsWith("FILE_PATH") &&
      !trimmed.startsWith("BASENAME") &&
      !trimmed.startsWith("echo ")
    ) {
      const cmd = trimmed.split(/\s+"\$FILE_PATH"/)[0].trim();
      if (cmd && !cmd.startsWith("[")) {
        commands.push(cmd);
      }
    }
  }
  return commands;
}

// 전체 명령어 체크
export async function checkHarnessCommands(
  hooks: { event: string; matcher: string; command: string }[],
  projectDir: string,
): Promise<CommandCheckResult[]> {
  const results: CommandCheckResult[] = [];
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  for (const hook of hooks) {
    const scriptPath = hook.command.replace(/^bash\s+/, "").replace(/^"|"$/g, "");
    const fullPath = path.join(projectDir, scriptPath);

    let content: string;
    try {
      content = await fs.readFile(fullPath, "utf-8");
    } catch {
      continue; // 스크립트 파일 없으면 스킵
    }

    const scriptName = path.basename(scriptPath);

    // pre-commit gate류 — 파일명 매칭 확장 + 내용 기반 감지
    if (
      scriptName.includes("pre-commit") ||
      scriptName.includes("test-gate") ||
      scriptName.includes("typecheck-gate") ||
      scriptName.includes("before-commit") ||
      /if\s+!\s+.+\s+>&?2/.test(content)
    ) {
      const commands = extractPreCommitCommands(content);
      const isTypecheck = scriptName.includes("typecheck") || commands.some((c) => /\btsc\b/.test(c));
      const category = isTypecheck ? "commit-typecheck-gate" : "commit-test-gate";
      for (const cmd of commands) {
        const binary = extractExecutable(cmd);
        const executable = await checkCommandExecutable(binary);
        results.push({ command: cmd, category, executable });
      }
    }

    // post-save류 (lint-on-save, format-on-save)
    if (
      scriptName.includes("post-save") ||
      scriptName.includes("lint-on-save") ||
      scriptName.includes("format-on-save")
    ) {
      const commands = extractPostSaveCommands(content);
      const category = scriptName.includes("format") ? "format-on-save" : "lint-on-save";
      for (const cmd of commands) {
        const binary = extractExecutable(cmd);
        const executable = await checkCommandExecutable(binary);
        results.push({ command: cmd, category, executable });
      }
    }

    // auto-pr (gh CLI 체크)
    if (scriptName.includes("auto-pr")) {
      const hasGh = await checkCommandExecutable("gh");
      results.push({ command: "gh", category: "auto-pr", executable: hasGh });
    }
  }

  return results;
}
