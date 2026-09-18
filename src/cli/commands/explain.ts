import chalk from "chalk";
import { readEvents, type HookEvent } from "../event-logger.js";
import { builtinBlocks } from "../../catalog/blocks/index.js";
import type { BuildingBlock } from "../../catalog/types.js";

// `omh explain` (#115): the agent sees the block reason, the human usually
// does not. Print the last few block decisions in plain language with the
// way to allow once and the way to change the rule. Text is owned by each
// block (BuildingBlock.explain); this command only formats.

export interface ExplainOptions {
  projectDir?: string;
  /** How many block decisions to show, newest first. Default 5. */
  last?: number;
  json?: boolean;
}

export interface ExplainEntry {
  ts: string;
  block: string;
  hook: string;
  reason: string;
  allowOnce?: string;
  change: string;
}

const GENERIC_CHANGE = (id: string) =>
  `harness.yaml > hooks > ${id}: set mode: ask, adjust its params, or remove the entry, then run omh sync`;
const UNKNOWN_HOOK_CHANGE =
  "this hook is not a catalog block: look it up in .claude/settings.json (or harness.yaml if you added it there)";

export function blockIdFromHook(hook: string): string {
  return hook.replace(/\.sh$/, "").replace(/^catalog-/, "").replace(/^harness-/, "");
}

function relativeTime(ts: string, now: number): string {
  const diff = Math.max(0, now - Date.parse(ts));
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function toEntry(ev: HookEvent, blocks: BuildingBlock[]): ExplainEntry {
  const id = blockIdFromHook(ev.hook);
  const block = blocks.find((b) => b.id === id);
  const reason = (ev.reason ?? "").replace(/^oh-my-harness:\s*/, "");
  return {
    ts: ev.ts,
    block: id,
    hook: ev.hook,
    reason,
    allowOnce: block?.explain?.allowOnce,
    change: block ? (block.explain?.change ?? GENERIC_CHANGE(id)) : UNKNOWN_HOOK_CHANGE,
  };
}

export function formatExplanation(ev: HookEvent, blocks: BuildingBlock[], now: number = Date.now()): string {
  const e = toEntry(ev, blocks);
  const lines = [
    `${chalk.dim(relativeTime(e.ts, now).padEnd(11))}${chalk.bold(e.block)}  ${chalk.red("blocked")}`,
    `           Because: ${e.reason || "(no reason recorded)"}`,
  ];
  if (e.allowOnce) lines.push(`           To allow once: ${e.allowOnce}`);
  lines.push(`           To change the rule: ${e.change}`);
  return lines.join("\n");
}

export async function explainCommand(options: ExplainOptions = {}): Promise<{ exitCode: number; entries: ExplainEntry[] }> {
  const projectDir = options.projectDir ?? process.cwd();
  const last = options.last && options.last > 0 ? options.last : 5;

  let events: HookEvent[] = [];
  try {
    events = await readEvents(projectDir);
  } catch {
    events = [];
  }
  const blocked = events.filter((e) => e.decision === "block").slice(-last).reverse();
  const entries = blocked.map((e) => toEntry(e, builtinBlocks));

  if (options.json) {
    console.log(JSON.stringify(entries, null, 2));
    return { exitCode: 0, entries };
  }
  if (blocked.length === 0) {
    console.log("No blocked tool calls in .omh/state/events.jsonl yet.");
    return { exitCode: 0, entries };
  }
  const now = Date.now();
  console.log(chalk.bold(`Last ${blocked.length} blocked tool call${blocked.length === 1 ? "" : "s"}:`));
  console.log("");
  for (const e of blocked) {
    console.log(formatExplanation(e, builtinBlocks, now));
    console.log("");
  }
  return { exitCode: 0, entries };
}
