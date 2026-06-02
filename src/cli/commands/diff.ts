import chalk from "chalk";
import { computeDrift, HarnessNotFoundError, type DriftChange } from "../../core/drift.js";

export interface DiffOptions {
  projectDir?: string;
}

export interface DiffResult {
  exitCode: number;
  inSync?: boolean;
}

/**
 * Minimal LCS line diff — enough to show what `omh sync` would change without
 * pulling in a diff dependency. Returns unified-style lines (" ", "-", "+").
 */
export function unifiedDiff(oldStr: string, newStr: string): string[] {
  const a = oldStr.split("\n");
  const b = newStr.split("\n");
  const n = a.length;
  const m = b.length;

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push(`- ${a[i]}`);
      i++;
    } else {
      out.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < n) out.push(`- ${a[i++]}`);
  while (j < m) out.push(`+ ${b[j++]}`);
  return out;
}

function printChange(change: DriftChange): void {
  const header = change.kind === "create" ? `+++ ${change.path} (new)` : `~~~ ${change.path}`;
  console.log(chalk.bold(header));
  const lines = unifiedDiff(change.current ?? "", change.planned);
  for (const line of lines) {
    if (line.startsWith("+")) console.log(chalk.green(line));
    else if (line.startsWith("-")) console.log(chalk.red(line));
    else console.log(chalk.dim(line));
  }
  console.log("");
}

/**
 * `omh diff`: human-readable preview of what `omh sync` would change, without
 * writing anything.
 */
export async function diffCommand(options: DiffOptions = {}): Promise<DiffResult> {
  const projectDir = options.projectDir ?? process.cwd();

  let drift;
  try {
    drift = await computeDrift(projectDir);
  } catch (err) {
    if (err instanceof HarnessNotFoundError) {
      console.error(chalk.red(err.message));
      console.error("Run `oh-my-harness init` to create one.");
    } else {
      console.error(chalk.red(`omh diff failed: ${(err as Error).message}`));
    }
    return { exitCode: 1 };
  }

  if (drift.inSync) {
    console.log(chalk.green("oh-my-harness: no changes — generated files are up to date"));
    return { exitCode: 0, inSync: true };
  }

  for (const change of drift.changed) {
    printChange(change);
  }
  for (const stale of drift.wouldDelete) {
    console.log(chalk.red(`--- ${stale} (would be removed)`));
  }
  return { exitCode: 0, inSync: false };
}
