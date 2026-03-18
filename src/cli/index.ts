import { Command } from "commander";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

export function createCli(): Command {
  const program = new Command();

  program
    .name("oh-my-harness")
    .description("AI code agent harness configuration tool")
    .version(pkg.version);

  program
    .command("init [description...]")
    .description("Initialize harness (NL description or --preset)")
    .option("-p, --preset <presets...>", "Use specific presets instead of NL")
    .option("-y, --yes", "Skip confirmation prompts")
    .action(async (description: string[], options) => {
      const { initCommand } = await import("./commands/init.js");
      await initCommand(description, options);
    });

  program
    .command("add <preset>")
    .description("Add a preset to existing harness")
    .action(async (preset: string) => {
      const { addCommand } = await import("./commands/add.js");
      await addCommand(preset);
    });

  program
    .command("remove <preset>")
    .description("Remove a preset from harness")
    .action(async (preset: string) => {
      const { removeCommand } = await import("./commands/remove.js");
      await removeCommand(preset);
    });

  program
    .command("doctor")
    .description("Validate harness configuration health")
    .action(async () => {
      const { doctorCommand } = await import("./commands/doctor.js");
      await doctorCommand();
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

  return program;
}
