import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { getConfigDir } from "../nl/config-store.js";

const execFileAsync = promisify(execFileCb);
const REPO = "kyu1204/oh-my-harness";
const STATE_FILE = "star-prompt.json";

interface StarState {
  prompted: boolean;
}

function getStatePath(): string {
  return path.join(getConfigDir(), STATE_FILE);
}

export async function hasStarPromptBeenShown(): Promise<boolean> {
  try {
    const raw = await fs.readFile(getStatePath(), "utf-8");
    const state = JSON.parse(raw) as StarState;
    return state.prompted === true;
  } catch {
    return false;
  }
}

export async function markStarPromptShown(): Promise<void> {
  const dir = getConfigDir();
  await fs.mkdir(dir, { recursive: true });

  const statePath = getStatePath();
  let prev: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      prev = parsed as Record<string, unknown>;
    }
  } catch {
    // Missing or invalid state file falls back to a fresh object.
  }

  await fs.writeFile(
    statePath,
    JSON.stringify({ ...prev, prompted: true }, null, 2) + "\n",
    "utf-8",
  );
}

export async function starRepo(): Promise<boolean> {
  try {
    await execFileAsync("gh", ["api", `user/starred/${REPO}`, "-X", "PUT"], {
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}
