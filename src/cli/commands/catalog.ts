import chalk from "chalk";
import { createDefaultRegistry } from "../../catalog/registry.js";

const CATEGORY_EMOJI: Record<string, string> = {
  git: "🔀",
  quality: "✅",
  security: "🛡️",
  "file-protection": "📁",
  "auto-fix": "🔧",
  automation: "🤖",
  session: "📋",
  notification: "🔔",
  prompt: "💬",
  permission: "🔐",
  audit: "📝",
};

function categoryLabel(category: string): string {
  const emoji = CATEGORY_EMOJI[category] ?? "•";
  const name = category
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return `${emoji} ${name}`;
}

export async function catalogListCommand(): Promise<void> {
  const registry = await createDefaultRegistry();
  const blocks = registry.list();

  if (blocks.length === 0) {
    console.log(chalk.yellow("No building blocks registered."));
    return;
  }

  // Group by category preserving insertion order
  const byCategory = new Map<string, typeof blocks>();
  for (const block of blocks) {
    const cat = block.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(block);
  }

  for (const [category, catBlocks] of byCategory) {
    console.log(chalk.bold(categoryLabel(category)));
    for (const block of catBlocks) {
      const id = chalk.cyan(block.id.padEnd(24));
      const desc = block.description.padEnd(48);
      const eventMatcher = block.matcher
        ? `${block.event}:${block.matcher}`
        : block.event;
      console.log(`  ${id} ${chalk.dim(block.name.padEnd(24))} ${desc} ${chalk.dim(eventMatcher)}`);
    }
    console.log();
  }
}

export async function catalogInfoCommand(blockId: string): Promise<void> {
  const registry = await createDefaultRegistry();
  const block = registry.get(blockId);

  if (!block) {
    console.error(chalk.red(`Block not found: ${blockId}`));
    process.exit(1);
    return;
  }

  console.log(chalk.bold(block.name));
  console.log(chalk.dim(block.description));
  console.log();
  console.log(`  ${chalk.bold("ID:")}       ${block.id}`);
  console.log(`  ${chalk.bold("Category:")} ${block.category}`);
  console.log(`  ${chalk.bold("Event:")}    ${block.event}`);
  if (block.matcher) {
    console.log(`  ${chalk.bold("Matcher:")} ${block.matcher}`);
  }
  console.log(`  ${chalk.bold("Tags:")}     ${block.tags.join(", ") || "(none)"}`);

  if (block.params.length > 0) {
    console.log();
    console.log(chalk.bold("Parameters:"));
    for (const param of block.params) {
      const required = param.required ? chalk.red("required") : chalk.dim("optional");
      const defaultVal = param.default !== undefined ? chalk.dim(` [default: ${JSON.stringify(param.default)}]`) : "";
      console.log(`  ${chalk.cyan(param.name)} (${param.type}) — ${required}${defaultVal}`);
      console.log(`    ${param.description}`);
    }
  }
}
