import { readEvents, aggregateStats, type HookEvent, type EventStats } from "../event-logger.js";
import { HarnessConfigSchema, type HarnessConfig } from "../../core/harness-schema.js";
import { builtinBlocks } from "../../catalog/blocks/index.js";
import type { BuildingBlock, HookEntry } from "../../catalog/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

export interface BlockStats {
  id: string;
  name: string;
  category: string;
  description: string;
  canBlock: boolean;
  configured: boolean;
  hits: number;
  blockCount: number;
  allowCount: number;
  lastHit?: string;
  lastBlockReason?: string;
  params: Record<string, unknown>;
}

export interface HourlyBucket {
  hour: number;
  total: number;
  blockCount: number;
  allowCount: number;
}

export type DateRange = "today" | "week" | "all";

export interface StatsData {
  totalEvents: number;
  blockCount: number;
  allowCount: number;
  blockRate: number;
  peakHour: number;
  blocks: BlockStats[];
  activeBlocks: BlockStats[];
  dormantBlocks: BlockStats[];
  hourlyDistribution: HourlyBucket[];
  dateRange: DateRange;
}

export function deduplicateBlocks(blocks: BlockStats[]): BlockStats[] {
  const map = new Map<string, BlockStats>();
  for (const b of blocks) {
    const existing = map.get(b.id);
    if (existing) {
      existing.hits += b.hits;
      existing.blockCount += b.blockCount;
      existing.allowCount += b.allowCount;
      if (b.lastHit && (!existing.lastHit || b.lastHit > existing.lastHit)) {
        existing.lastHit = b.lastHit;
      }
      if (b.lastBlockReason) {
        existing.lastBlockReason = b.lastBlockReason;
      }
    } else {
      map.set(b.id, { ...b });
    }
  }
  return [...map.values()];
}

export function getActiveBlocks(
  hookEntries: HookEntry[],
  allBlocks: BuildingBlock[],
): { block: BuildingBlock; params: Record<string, unknown> }[] {
  const result: { block: BuildingBlock; params: Record<string, unknown> }[] = [];
  for (const entry of hookEntries) {
    const block = allBlocks.find(b => b.id === entry.block);
    if (block) {
      result.push({ block, params: entry.params as Record<string, unknown> });
    }
  }
  return result;
}

export function getDormantBlocks(
  activeBlocks: { block: BuildingBlock; params: Record<string, unknown> }[],
  events: HookEvent[],
): string[] {
  const hitHooks = new Set(events.map(e =>
    e.hook.replace(/\.sh$/, "").replace(/^catalog-/, "").replace(/^harness-/, ""),
  ));
  return activeBlocks
    .filter(ab => !hitHooks.has(ab.block.id))
    .map(ab => ab.block.id);
}

export function getHourlyDistribution(events: HookEvent[]): HourlyBucket[] {
  const buckets: HourlyBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    total: 0,
    blockCount: 0,
    allowCount: 0,
  }));
  for (const e of events) {
    const hour = new Date(e.ts).getHours();
    if (hour >= 0 && hour < 24) {
      buckets[hour].total++;
      if (e.decision === "block") buckets[hour].blockCount++;
      else buckets[hour].allowCount++;
    }
  }
  return buckets;
}

export function getDateFilteredEvents(
  events: HookEvent[],
  range: DateRange,
): HookEvent[] {
  if (range === "all") return events;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "today") {
    return events.filter(e => new Date(e.ts) >= startOfToday);
  }
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);
  return events.filter(e => new Date(e.ts) >= startOfWeek);
}

export function getBlockDetail(
  blockId: string,
  events: HookEvent[],
  allBlocks: BuildingBlock[],
  params: Record<string, unknown> = {},
): BlockStats {
  const block = allBlocks.find(b => b.id === blockId);
  const hookEvents = events.filter(e => {
    const normalized = e.hook.replace(/\.sh$/, "").replace(/^catalog-/, "").replace(/^harness-/, "");
    return normalized === blockId;
  });

  const blockCount = hookEvents.filter(e => e.decision === "block").length;
  const allowCount = hookEvents.filter(e => e.decision === "allow").length;
  const lastHitEvent = hookEvents.length > 0 ? hookEvents[hookEvents.length - 1] : undefined;
  const lastBlockEvent = [...hookEvents].reverse().find(e => e.decision === "block");

  return {
    id: blockId,
    name: block?.name ?? blockId,
    category: block?.category ?? "unknown",
    description: block?.description ?? "",
    canBlock: block?.canBlock ?? false,
    configured: true,
    hits: hookEvents.length,
    blockCount,
    allowCount,
    lastHit: lastHitEvent?.ts,
    lastBlockReason: lastBlockEvent?.reason,
    params,
  };
}

export async function loadStatsData(
  projectDir: string,
  dateRange: DateRange = "all",
): Promise<StatsData> {
  const allEvents = await readEvents(projectDir);
  const events = getDateFilteredEvents(allEvents, dateRange);

  let hookEntries: HookEntry[] = [];
  try {
    const harnessPath = path.join(projectDir, "harness.yaml");
    const raw = await fs.readFile(harnessPath, "utf-8");
    const parsed = yaml.load(raw);
    const result = HarnessConfigSchema.safeParse(parsed);
    if (result.success) {
      hookEntries = result.data.hooks ?? [];
    }
  } catch {
    // harness.yaml 없으면 빈 배열
  }

  const activeBlocksWithParams = getActiveBlocks(hookEntries, builtinBlocks);
  const dormantIds = getDormantBlocks(activeBlocksWithParams, events);

  const blocks = deduplicateBlocks(
    activeBlocksWithParams.map(ab =>
      getBlockDetail(ab.block.id, events, builtinBlocks, ab.params),
    ),
  );

  const activeBlocks = deduplicateBlocks(blocks.filter(b => !dormantIds.includes(b.id)));
  const dormantBlocks = deduplicateBlocks(blocks.filter(b => dormantIds.includes(b.id)));

  const hourlyDistribution = getHourlyDistribution(events);

  const stats = aggregateStats(events);
  const peakHour = hourlyDistribution.reduce(
    (max, b) => b.total > max.total ? b : max,
    hourlyDistribution[0],
  ).hour;
  const blockRate = stats.totalEvents > 0
    ? Math.round((stats.blockCount / stats.totalEvents) * 100)
    : 0;

  return {
    totalEvents: stats.totalEvents,
    blockCount: stats.blockCount,
    allowCount: stats.allowCount,
    blockRate,
    peakHour,
    blocks,
    activeBlocks,
    dormantBlocks,
    hourlyDistribution,
    dateRange,
  };
}
