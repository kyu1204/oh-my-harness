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
    .action(async () => {
      const { doctorCommand } = await import("./commands/doctor.js");
      const result = await doctorCommand();
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
    .action(async (options: { projectDir?: string }) => {
      const { syncCommand } = await import("./commands/sync.js");
      await syncCommand(options);
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
