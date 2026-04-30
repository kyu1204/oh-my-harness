import { spawnSync } from "node:child_process";
import { detectInstaller } from "../installer-detect.js";
import { fetchLatestVersion } from "../version-checker.js";

export interface UpdateOptions {
  yes?: boolean;
  dryRun?: boolean;
}

export interface UpdateDeps {
  fetchLatest?: (name: string) => Promise<string | null>;
  spawn?: (cmd: string, args: string[]) => { status: number };
  env?: NodeJS.ProcessEnv;
}

export interface UpdateResult {
  exitCode: number;
  ran: boolean;
  command?: string;
  latestVersion?: string;
}

const PKG_NAME = "oh-my-harness";

function defaultSpawn(cmd: string, args: string[]): { status: number } {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  return { status: result.status ?? 1 };
}

export async function updateCommand(
  currentVersion: string,
  options: UpdateOptions = {},
  deps: UpdateDeps = {},
): Promise<UpdateResult> {
  const fetchLatest = deps.fetchLatest ?? fetchLatestVersion;
  const spawn = deps.spawn ?? defaultSpawn;
  const env = deps.env ?? process.env;

  console.log(`Current version: ${currentVersion}`);
  console.log("Checking for updates…");

  const latest = await fetchLatest(PKG_NAME);
  if (!latest) {
    console.log(
      "Could not reach npm registry. Check your network and try again.",
    );
    return { exitCode: 1, ran: false };
  }

  if (latest === currentVersion) {
    console.log(`Already up to date (${currentVersion}).`);
    return { exitCode: 0, ran: false, latestVersion: latest };
  }

  console.log(`Update available: ${currentVersion} → ${latest}`);

  const info = detectInstaller(env);
  console.log(`Detected installer: ${info.installer}`);
  if (info.notes) {
    console.log(info.notes);
  }
  console.log(`Update command: ${info.updateCommand}`);

  if (info.isEphemeral) {
    console.log("Run the command above to install globally.");
    return {
      exitCode: 0,
      ran: false,
      command: info.updateCommand,
      latestVersion: latest,
    };
  }

  if (options.dryRun) {
    return {
      exitCode: 0,
      ran: false,
      command: info.updateCommand,
      latestVersion: latest,
    };
  }

  if (!options.yes && process.stdout.isTTY && process.stdin.isTTY) {
    const { confirm } = await import("@inquirer/prompts");
    const proceed = await confirm({
      message: `Run "${info.updateCommand}"?`,
      default: true,
    });
    if (!proceed) {
      console.log("Cancelled.");
      return {
        exitCode: 0,
        ran: false,
        command: info.updateCommand,
        latestVersion: latest,
      };
    }
  }

  const [cmd, ...args] = info.updateCommand.split(" ");
  const { status } = spawn(cmd, args);
  if (status === 0) {
    console.log(`Updated to ${latest}.`);
  } else {
    console.log(
      `Update failed with exit code ${status}. Try running the command manually.`,
    );
  }

  return {
    exitCode: status,
    ran: true,
    command: info.updateCommand,
    latestVersion: latest,
  };
}
