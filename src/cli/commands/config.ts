import chalk from "chalk";
import {
  loadProviderConfig,
  deleteProviderConfig,
  maskApiKey,
  type ProviderConfig,
} from "../../nl/config-store.js";

export interface ConfigOptions {
  /** Print the current provider config (masked) without changing anything. */
  show?: boolean;
  /** Delete the saved provider config. */
  reset?: boolean;
  /** Skip confirmation prompts. */
  yes?: boolean;
  /**
   * Interactive provider setup. Injectable for tests; defaults to the clack TUI.
   * Returns the saved config, or undefined if the user cancelled.
   */
  setupRunner?: () => Promise<ProviderConfig | undefined>;
  /** Confirmation prompt. Injectable for tests; defaults to the clack TUI. */
  confirm?: (message: string) => Promise<boolean>;
}

export interface ConfigResult {
  exitCode: number;
}

const NO_CONFIG_MESSAGE =
  "No AI provider configured yet. Run `omh config` (or `omh init`) to set one up.";

function printSummary(config: ProviderConfig): void {
  console.log(chalk.bold("Current AI provider configuration:"));
  console.log(`  provider: ${chalk.cyan(config.provider)}`);
  console.log(`  method:   ${chalk.cyan(config.method)}`);
  if (config.method === "api") {
    console.log(`  model:    ${chalk.cyan(config.model ?? "(default)")}`);
    console.log(`  api key:  ${chalk.dim(maskApiKey(config.apiKey))}`);
  } else {
    console.log(`  command:  ${chalk.cyan(config.cliCommand ?? config.provider)}`);
  }
}

async function defaultConfirm(message: string): Promise<boolean> {
  const p = await import("@clack/prompts");
  const answer = await p.confirm({ message });
  if (p.isCancel(answer)) return false;
  return answer === true;
}

async function defaultSetupRunner(): Promise<ProviderConfig | undefined> {
  const { runProviderSetup } = await import("../tui/provider-setup.js");
  return runProviderSetup();
}

/**
 * `omh config`: view, reconfigure, or reset the saved AI provider used for
 * natural-language mode (~/.omh/config.json). Without flags it shows the current
 * config and launches the provider setup flow so a user can rotate an expired
 * key or switch providers.
 */
export async function configCommand(options: ConfigOptions = {}): Promise<ConfigResult> {
  const existing = await loadProviderConfig();

  // --show: read-only summary.
  if (options.show) {
    if (!existing) {
      console.log(NO_CONFIG_MESSAGE);
      return { exitCode: 0 };
    }
    printSummary(existing);
    return { exitCode: 0 };
  }

  // --reset: delete the saved config.
  if (options.reset) {
    if (!existing) {
      console.log(NO_CONFIG_MESSAGE);
      return { exitCode: 0 };
    }
    const confirm = options.confirm ?? defaultConfirm;
    const ok = options.yes ? true : await confirm("Delete the saved AI provider configuration?");
    if (!ok) {
      console.log("Aborted. Configuration left unchanged.");
      return { exitCode: 0 };
    }
    await deleteProviderConfig();
    console.log(chalk.green("Removed ~/.omh/config.json"));
    return { exitCode: 0 };
  }

  // Default: show current config (if any), then reconfigure.
  if (existing) {
    printSummary(existing);
    console.log("");
  } else {
    console.log("No AI provider configured yet. Let's set one up.\n");
  }

  const setupRunner = options.setupRunner ?? defaultSetupRunner;
  const updated = await setupRunner();
  if (!updated) {
    // Setup was cancelled; nothing changed.
    return { exitCode: 0 };
  }

  return { exitCode: 0 };
}
