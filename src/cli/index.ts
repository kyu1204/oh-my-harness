import { Command } from "commander";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { name: string; version: string };

export function createCli(): Command {
  const program = new Command();

  program
    .name("oh-my-harness")
    .description("AI code agent harness configuration tool")
    .version(pkg.version);

  program
    .command("update")
    .description("Check for and install the latest version of oh-my-harness")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--dry-run", "Print the update command without running it")
    .action(async (options: { yes?: boolean; dryRun?: boolean }) => {
      const { updateCommand } = await import("./commands/update.js");
      const result = await updateCommand(pkg.version, options);
      if (result.exitCode !== 0) {
        process.exitCode = result.exitCode;
      }
    });

  program
    .command("init [description...]")
    .description("Initialize harness from a project description")
    .option("-y, --yes", "Skip confirmation prompts")
    .action(async (description: string[], options) => {
      const { initCommand } = await import("./commands/init.js");
      await initCommand(description, options);
    });

  program
    .command("doctor")
    .description("Validate harness configuration health")
    .option("-d, --project-dir <dir>", "Project directory")
    .option("--strict", "Treat drift (out-of-sync generated files) as a failure")
    .action(async (options: { projectDir?: string; strict?: boolean }) => {
      const { doctorCommand } = await import("./commands/doctor.js");
      const result = await doctorCommand(options);
      if (result.exitCode !== 0) {
        process.exitCode = result.exitCode;
      }
    });

  program
    .command("diff")
    .description("Preview what `omh sync` would change, without writing")
    .option("-d, --project-dir <dir>", "Project directory")
    .action(async (options: { projectDir?: string }) => {
      const { diffCommand } = await import("./commands/diff.js");
      const result = await diffCommand(options);
      if (result.exitCode !== 0) {
        process.exitCode = result.exitCode;
      }
    });

  program
    .command("test")
    .description("Dry-run test harness hooks and commands")
    .option("-d, --project-dir <dir>", "Project directory")
    .action(async (options: { projectDir?: string }) => {
      const { testCommand } = await import("./commands/test.js");
      await testCommand(options);
    });

  program
    .command("sync")
    .description("Regenerate files from harness.yaml")
    .option("-d, --project-dir <dir>", "Project directory")
    .option("--check", "Report drift without writing; exit non-zero if out of date")
    .action(async (options: { projectDir?: string; check?: boolean }) => {
      const { syncCommand } = await import("./commands/sync.js");
      const result = await syncCommand(options);
      if (result.exitCode !== 0) {
        process.exitCode = result.exitCode;
      }
    });

  program
    .command("uninstall")
    .description("Safely remove oh-my-harness generated files while preserving user content")
    .option("-d, --project-dir <dir>", "Project directory")
    .option("--dry-run", "Print the uninstall plan without writing")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--purge", "Also delete harness.yaml")
    .option("--skip-backup-warning", "Suppress the backup recommendation")
    .option("--continue-on-error", "Keep applying independent operations after failures")
    .action(async (options: {
      projectDir?: string;
      dryRun?: boolean;
      yes?: boolean;
      purge?: boolean;
      skipBackupWarning?: boolean;
      continueOnError?: boolean;
    }) => {
      const { uninstallCommand } = await import("./commands/uninstall.js");
      const result = await uninstallCommand(options);
      if (result.exitCode !== 0) {
        process.exitCode = result.exitCode;
      }
    });

  program
    .command("config")
    .description("View, reconfigure, or reset the saved AI provider")
    .option("--show", "Show the current provider config (API key masked)")
    .option("--reset", "Delete the saved provider config")
    .option("-y, --yes", "Skip confirmation prompts")
    .action(async (options: { show?: boolean; reset?: boolean; yes?: boolean }) => {
      const { configCommand } = await import("./commands/config.js");
      const result = await configCommand(options);
      if (result.exitCode !== 0) {
        process.exitCode = result.exitCode;
      }
    });

  program
    .command("stats")
    .description("TUI dashboard for harness analytics")
    .action(async () => {
      const { statsCommand } = await import("./stats/index.js");
      await statsCommand();
    });

  const catalogCmd = program
    .command("catalog")
    .description("Browse available building blocks");

  catalogCmd
    .command("list")
    .description("List all available building blocks")
    .action(async () => {
      const { catalogListCommand } = await import("./commands/catalog.js");
      await catalogListCommand();
    });

  catalogCmd
    .command("info <block-id>")
    .description("Show building block details")
    .action(async (blockId: string) => {
      const { catalogInfoCommand } = await import("./commands/catalog.js");
      await catalogInfoCommand(blockId);
    });

  const loopCmd = program
    .command("loop")
    .description("Run the autonomous loop (see the omh-loop skill)");

  loopCmd
    .command("start")
    .description("Start the loop supervisor in the background")
    .option("-d, --project-dir <dir>", "Project directory")
    .action(async (options: { projectDir?: string }) => {
      const { loopStartCommand } = await import("./commands/loop.js");
      const result = await loopStartCommand(options);
      if (result.exitCode !== 0) process.exitCode = result.exitCode;
    });

  loopCmd
    .command("run")
    .description("Run the loop supervisor in the foreground (used by start)")
    .requiredOption("--run-id <id>", "Run identifier")
    .option("-d, --project-dir <dir>", "Project directory")
    .action(async (options: { runId: string; projectDir?: string }) => {
      const { loopRunCommand } = await import("./commands/loop.js");
      const result = await loopRunCommand(options);
      if (result.exitCode !== 0) process.exitCode = result.exitCode;
    });

  loopCmd
    .command("stop")
    .description("Stop the running loop")
    .option("--now", "Skip the grace period")
    .option("-d, --project-dir <dir>", "Project directory")
    .action(async (options: { now?: boolean; projectDir?: string }) => {
      const { loopStopCommand } = await import("./commands/loop.js");
      const result = await loopStopCommand(options);
      if (result.exitCode !== 0) process.exitCode = result.exitCode;
    });

  loopCmd
    .command("status")
    .description("Show the current loop run")
    .option("-d, --project-dir <dir>", "Project directory")
    .action(async (options: { projectDir?: string }) => {
      const { loopStatusCommand } = await import("./commands/loop.js");
      const result = await loopStatusCommand(options);
      if (result.exitCode !== 0) process.exitCode = result.exitCode;
    });

  loopCmd
    .command("clean")
    .description("Remove the loop worktree and stale state")
    .option("--branch", "Also delete the omh-loop branch")
    .option("-d, --project-dir <dir>", "Project directory")
    .action(async (options: { branch?: boolean; projectDir?: string }) => {
      const { loopCleanCommand } = await import("./commands/loop.js");
      const result = await loopCleanCommand(options);
      if (result.exitCode !== 0) process.exitCode = result.exitCode;
    });

  const hookCmd = program
    .command("hook")
    .description("Manage hooks");

  hookCmd
    .command("add <block-id>")
    .description("Add a hook from the catalog")
    .option("-y, --yes", "Skip confirmation prompts")
    .option("-d, --project-dir <dir>", "Project directory")
    .action(async (blockId: string, options: { yes?: boolean; projectDir?: string }) => {
      const { hookAddCommand } = await import("./commands/hook.js");
      await hookAddCommand(blockId, options);
    });

  hookCmd
    .command("remove <block-id>")
    .description("Remove a hook")
    .option("-d, --project-dir <dir>", "Project directory")
    .action(async (blockId: string, options: { projectDir?: string }) => {
      const { hookRemoveCommand } = await import("./commands/hook.js");
      await hookRemoveCommand(blockId, options);
    });

  program.on("command:*", () => {
    console.error(`error: unknown command '${program.args[0]}'`);
    console.error(`Run 'oh-my-harness --help' for a list of available commands.`);
    process.exitCode = 1;
  });

  return program;
}
