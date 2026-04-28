import fs from "node:fs/promises";
import path from "node:path";
import { OMH_HOOKS_DIR } from "../../utils/paths.js";

export interface DoctorOptions {
  projectDir?: string;
}

export interface DoctorResult {
  healthy: boolean;
  exitCode: number;
  checks: {
    stateFile: boolean;
    claudeMd: boolean;
    agentsMd: boolean;
    settingsJson: boolean;
    codexConfig: boolean;
    hooksExecutable: boolean;
  };
  messages: string[];
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<DoctorResult> {
  const projectDir = options.projectDir ?? process.cwd();
  const messages: string[] = [];

  const checks = {
    stateFile: false,
    claudeMd: false,
    agentsMd: false,
    settingsJson: false,
    codexConfig: false,
    hooksExecutable: false,
  };

  // 1. Check .claude/oh-my-harness.json exists
  const stateFile = path.join(projectDir, ".claude", "oh-my-harness.json");
  try {
    await fs.access(stateFile);
    checks.stateFile = true;
  } catch {
    messages.push("FAIL: .claude/oh-my-harness.json not found. Run `oh-my-harness init` first.");
  }

  // 2. Check CLAUDE.md exists and has managed markers
  const claudeMdPath = path.join(projectDir, "CLAUDE.md");
  try {
    const content = await fs.readFile(claudeMdPath, "utf-8");
    if (content.includes("<!-- oh-my-harness:")) {
      checks.claudeMd = true;
    } else {
      messages.push("WARN: CLAUDE.md exists but has no oh-my-harness managed sections.");
      checks.claudeMd = true; // File exists, just no markers — acceptable
    }
  } catch {
    messages.push("FAIL: CLAUDE.md not found.");
  }

  // 3. Check settings.json exists and is valid JSON
  const settingsPath = path.join(projectDir, ".claude", "settings.json");
  try {
    const raw = await fs.readFile(settingsPath, "utf-8");
    JSON.parse(raw);
    checks.settingsJson = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      messages.push("FAIL: .claude/settings.json not found.");
    } else {
      messages.push("FAIL: .claude/settings.json is not valid JSON.");
    }
  }

  // 4. AGENTS.md (Codex)
  const agentsMdPath = path.join(projectDir, "AGENTS.md");
  try {
    await fs.access(agentsMdPath);
    checks.agentsMd = true;
  } catch {
    messages.push("FAIL: AGENTS.md not found.");
  }

  // 5. .codex/hooks.json + .codex/config.toml
  const codexHooksPath = path.join(projectDir, ".codex", "hooks.json");
  const codexTomlPath = path.join(projectDir, ".codex", "config.toml");
  try {
    await fs.access(codexHooksPath);
    const tomlRaw = await fs.readFile(codexTomlPath, "utf-8");
    if (!tomlRaw.includes("codex_hooks = true")) {
      messages.push("FAIL: .codex/config.toml missing [features] codex_hooks = true.");
    } else {
      checks.codexConfig = true;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      messages.push("FAIL: .codex/hooks.json or .codex/config.toml not found.");
    } else {
      messages.push("FAIL: .codex/config.toml unreadable.");
    }
  }

  // 6. Check hook scripts exist and are executable
  const hooksDir = path.join(projectDir, OMH_HOOKS_DIR);
  try {
    const files = await fs.readdir(hooksDir);
    const scripts = files.filter((f) => f.endsWith(".sh"));
    let allExecutable = true;

    for (const script of scripts) {
      const scriptPath = path.join(hooksDir, script);
      try {
        await fs.access(scriptPath, fs.constants.X_OK);
      } catch {
        messages.push(`FAIL: Hook script not executable: ${script}`);
        allExecutable = false;
      }
    }

    checks.hooksExecutable = allExecutable;
  } catch {
    // No hooks dir — acceptable if no hooks defined
    checks.hooksExecutable = true;
  }

  const healthy = Object.values(checks).every(Boolean);
  const exitCode = healthy ? 0 : 1;

  if (healthy) {
    console.log("oh-my-harness: all checks passed");
  } else {
    console.log("oh-my-harness: some checks failed:");
    for (const msg of messages) {
      console.log(`  ${msg}`);
    }
  }

  return { healthy, exitCode, checks, messages };
}
