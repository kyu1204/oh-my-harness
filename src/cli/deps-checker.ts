import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DepCheck {
  name: string;
  command: string;
  required: boolean;
  purpose: string;
  installHint: string;
  installed: boolean;
  version?: string;
}

interface DepSpec {
  name: string;
  command: string;
  versionCommand: string;
  required: boolean;
  purpose: string;
  installHint: string;
}

const DEPS: DepSpec[] = [
  {
    name: "jq",
    command: "jq",
    versionCommand: "jq --version",
    required: true,
    purpose: "Parses tool input in hook scripts",
    installHint: "brew install jq",
  },
  {
    name: "claude",
    command: "claude",
    versionCommand: "claude --version",
    required: false,
    purpose: "Enables natural language harness generation",
    installHint: "npm install -g @anthropic-ai/claude-code",
  },
  {
    name: "git",
    command: "git",
    versionCommand: "git --version",
    required: true,
    purpose: "Version control",
    installHint: "brew install git",
  },
  {
    name: "node",
    command: "node",
    versionCommand: "node --version",
    required: true,
    purpose: "Runtime",
    installHint: "brew install node",
  },
];

export async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync("which", [command]);
    return true;
  } catch {
    return false;
  }
}

async function getVersion(versionCommand: string): Promise<string | undefined> {
  try {
    const parts = versionCommand.split(" ");
    const { stdout } = await execFileAsync(parts[0], parts.slice(1));
    const trimmed = stdout.trim();
    // Extract version-like string from output
    const match = trimmed.match(/[\d]+\.[\d]+[\w.\-]*/);
    return match ? match[0] : trimmed.split("\n")[0];
  } catch {
    return undefined;
  }
}

export async function checkDependencies(): Promise<DepCheck[]> {
  const results: DepCheck[] = [];

  for (const dep of DEPS) {
    const installed = await commandExists(dep.command);
    let version: string | undefined;
    if (installed) {
      version = await getVersion(dep.versionCommand);
    }
    results.push({
      name: dep.name,
      command: dep.command,
      required: dep.required,
      purpose: dep.purpose,
      installHint: dep.installHint,
      installed,
      version,
    });
  }

  return results;
}
