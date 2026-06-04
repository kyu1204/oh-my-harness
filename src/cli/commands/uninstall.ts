import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  applyUninstallPlan,
  computeUninstall,
  type UninstallPlan,
  type UninstallResult,
} from "../../core/uninstall.js";

export interface UninstallOptions {
  projectDir?: string;
  dryRun?: boolean;
  yes?: boolean;
  purge?: boolean;
  skipBackupWarning?: boolean;
  continueOnError?: boolean;
}

export interface UninstallCommandResult {
  exitCode: number;
  plan: UninstallPlan;
  result?: UninstallResult;
}

function visibleWarnings(plan: UninstallPlan, options: UninstallOptions): string[] {
  return plan.destructiveWarnings.filter((warning) =>
    !(options.skipBackupWarning && warning.includes("백업 후 실행 권장")),
  );
}

export function renderUninstallPlan(plan: UninstallPlan, options: UninstallOptions = {}): string {
  const warnings = visibleWarnings(plan, options);
  const lines = [
    "oh-my-harness uninstall plan",
    `- delete: ${plan.delete.length} files/directories`,
    `- modify: ${plan.modify.length} files`,
    `- keep: ${plan.keptHarnessYaml ? "harness.yaml" : "none"}`,
    `- warnings: ${warnings.length}`,
  ];

  if (warnings.length > 0) {
    lines.push("", "Safety:");
    for (const warning of warnings) lines.push(`- ${warning}`);
  }

  if (plan.modify.length > 0) {
    lines.push("", "modify:");
    for (const item of plan.modify) lines.push(`  ${item.path}`);
  }
  if (plan.delete.length > 0) {
    lines.push("", "delete:");
    for (const target of plan.delete) lines.push(`  ${target}`);
  }
  if (plan.removeDirs.length > 0) {
    lines.push("", "remove empty dirs:");
    for (const dir of plan.removeDirs) lines.push(`  ${dir}`);
  }

  return lines.join("\n");
}

function renderResult(result: UninstallResult): string {
  const lines = [
    "oh-my-harness uninstall result",
    `modified: ${result.modified.length}`,
    `deleted: ${result.deleted.length}`,
    `removedDirs: ${result.removedDirs.length}`,
    `restored: ${result.restored.length}`,
    `failed: ${result.failed.length}`,
  ];
  for (const failure of result.failed) {
    lines.push(`  ${failure.op}: ${failure.path} — ${failure.message}`);
  }
  return lines.join("\n");
}

async function confirmUninstall(): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Proceed with uninstall? Type 'yes' to continue: ");
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

export async function uninstallCommand(options: UninstallOptions = {}): Promise<UninstallCommandResult> {
  const projectDir = options.projectDir ?? process.cwd();
  const plan = await computeUninstall({ projectDir, purge: options.purge });
  console.log(renderUninstallPlan(plan, options));

  if (options.dryRun) {
    return { exitCode: 0, plan };
  }

  if (!options.yes && !await confirmUninstall()) {
    console.log("oh-my-harness: uninstall cancelled");
    return { exitCode: 1, plan };
  }

  const result = await applyUninstallPlan(plan, { continueOnError: options.continueOnError });
  console.log(renderResult(result));
  return { exitCode: result.failed.length === 0 ? 0 : 1, plan, result };
}
